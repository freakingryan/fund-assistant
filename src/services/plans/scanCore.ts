/**
 * 规则评估核心（纯函数，App 与 Service Worker 共用）
 *
 * 这是「计划扫描」的单一真理来源。它只做一件事：给定持仓 + 计划规则 +
 * 注入的数据获取策略，返回所有命中的提醒（PlanAlert[]）。
 *
 * 设计约束（为什么要把它单独抽出来）：
 *   投资计划的提醒需要「在页面关闭后也能触发」（Phase 17 Web Push 定时扫描）。
 *   但 Service Worker 没有 DOM，`dataSourceService.fetchQuotes` 最终走的是
 *   场外基金 JSONP（注入 <script>），无法在 SW 中运行；`computeFundTrendScore`
 *   也间接依赖 DOM 数据层。因此本模块：
 *     1. 不 import 任何 DOM / Zustand / dataSourceService；
 *     2. 所有「外部依赖」通过 `strategy` 注入 —— App 注入完整实现，
 *        SW 注入 SW 安全实现（如 quoteCache + Worker 代理），并传
 *        `computeTrendScore: undefined` 以优雅跳过 trend 规则；
 *     3. 去重前置数据（existingKeys / dcaAlertMap）由调用方注入，本模块
 *        不读写 IndexedDB。
 *
 * 这样 App 的 scan() 与 SW 的后台扫描调用同一个 `evaluatePlanRules`，
 * 规则语义 100% 一致，且不重复实现 switch 逻辑。
 *
 * @module plans/scanCore
 */

import type {
  Comparator,
  EtfMapping,
  FundHolding,
  FundQuote,
  InvestmentPlan,
  KLineData,
  PlanAlert,
} from "@/types";
// 仅 type-only 引入：编译期擦除，不会把 DOM 绑定的 decisionSnapshot 拉进 SW 包。
import type { FundTrendResult } from "@/services/backtest/decisionSnapshot";
import { detectPatterns, formatPatternsSummary } from "@/services/klinePatterns";
import { resolveHoldingCost } from "@/lib/holdingCost";

/** SW 后台扫描使用的 K 线周期（与 App 保持一致） */
export const SCAN_KLINE_PERIOD = "3m";

/**
 * 注入的数据获取策略。
 * App 提供全部实现；SW 仅提供 SW 安全实现，并省略 computeTrendScore。
 */
export interface ScanStrategy {
  /** 批量获取最新净值/估值与日涨跌幅 */
  fetchQuotes: (codes: string[]) => Promise<FundQuote[]>;
  /** 获取 ETF 真实 K 线（用于 kline_pattern 规则） */
  fetchEtfKLine: (code: string, period: string) => Promise<KLineData[]>;
  /**
   * 趋势评分（trend 规则）。仅 App 提供；SW 传 undefined，
   * 此时 trend 规则会被优雅跳过（不报错、不误触发）。
   */
  computeTrendScore?: (
    fund: FundHolding,
    etfMappings: EtfMapping[],
  ) => Promise<FundTrendResult | null>;
  /** ETF 映射表（来自设置），用于 kline_pattern / trend 规则定位场内标的 */
  etfMappings: EtfMapping[];
}

/** 去重前置数据，由调用方从存储读取后注入 */
export interface ScanDedup {
  /** 已存在且未处理的 fundCode|ruleId，命中即跳过（避免重复提醒） */
  existingKeys: Set<string>;
  /** fundCode|dca → 最近一次 dca 提醒的 triggeredAt（用于「距上次 N 天」判定） */
  dcaAlertMap: Map<string, string>;
}

export interface ScanInput {
  holdings: FundHolding[];
  plan: InvestmentPlan;
  strategy: ScanStrategy;
  dedup: ScanDedup;
}

/**
 * 纯评估：遍历 持仓 × 启用规则，返回命中的 PlanAlert[]。
 *
 * 不读写 DB、不触发通知、不读 Zustand；可在 Service Worker 中运行。
 * 调用方负责：去重数据注入、DB 持久化、通知分发。
 */
export async function evaluatePlanRules(input: ScanInput): Promise<PlanAlert[]> {
  const { holdings, plan, strategy, dedup } = input;
  const enabledRules = plan.rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return [];

  const codes = holdings.map((h) => h.code);
  const quotes = await strategy.fetchQuotes(codes);
  const quoteMap = new Map(quotes.map((q) => [q.code, q]));

  const alerts: PlanAlert[] = [];
  const now = new Date().toISOString();
  // 同一 ETF 在本轮扫描内只请求一次 K 线（避免重复网络请求）
  const klineMemo = new Map<string, KLineData[]>();

  for (const h of holdings) {
    const q = quoteMap.get(h.code);
    if (!q) continue;

    const nav = q.nav;
    // 统一成本解析（兼容方式一/方式二；方式二无需实时净值即可得收益率/盈亏）
    const rc = resolveHoldingCost(h, nav);
    const { costNAV, costKnown, pnlKnown, returnRate, totalPnl } = rc;
    const effectiveReturnRate = pnlKnown
      ? costKnown
        ? ((nav - costNAV) / costNAV) * 100
        : returnRate
      : 0;

    for (const rule of enabledRules) {
      // 跳过已有未处理的相同 fundCode+ruleId
      if (dedup.existingKeys.has(`${h.code}|${rule.id}`)) continue;

      let triggered = false;
      let reason = "";

      switch (rule.type) {
        case "return": {
          // 盈亏未知（既无成本净值/份额，又无持有收益）时无法判定收益率，跳过
          if (!pnlKnown) break;
          if (compare(effectiveReturnRate, rule.comparator, rule.threshold)) {
            triggered = true;
            reason = `收益率 ${effectiveReturnRate >= 0 ? "+" : ""}${effectiveReturnRate.toFixed(2)}% ${cmpLabel(rule.comparator)} ${rule.threshold}%`;
          }
          break;
        }
        case "price_diff": {
          // 单价成本为 0 时 diff=nav 会产生虚假价差买入提醒，跳过
          if (costNAV <= 0) break;
          const diff = nav - costNAV;
          if (compare(diff, rule.comparator, rule.threshold)) {
            triggered = true;
            reason = `净值价差 ¥${diff.toFixed(4)} ${cmpLabel(rule.comparator)} ¥${rule.threshold}`;
          }
          break;
        }
        case "daily_change": {
          if (compare(q.dailyChange, rule.comparator, rule.threshold)) {
            triggered = true;
            reason = `今日涨跌幅 ${q.dailyChange >= 0 ? "+" : ""}${q.dailyChange.toFixed(2)}% ${cmpLabel(rule.comparator)} ${rule.threshold}%`;
          }
          break;
        }
        case "dca": {
          const lastDate = dedup.dcaAlertMap.get(`${h.code}|dca`);
          if (!lastDate) {
            triggered = true;
            reason = `定期定投提醒：已过 ${rule.threshold} 天未定投`;
          } else {
            const daysSince = (Date.now() - new Date(lastDate).getTime()) / 86400000;
            if (daysSince >= rule.threshold) {
              triggered = true;
              reason = `定期定投提醒：距上次 ${Math.round(daysSince)} 天`;
            }
          }
          break;
        }
        case "kline_pattern": {
          const mapping = strategy.etfMappings.find((m) => m.otcCode === h.code);
          if (!mapping) continue; // 无 ETF 映射无法获取 K 线

          try {
            let klineData = klineMemo.get(mapping.exchangeCode);
            if (!klineData) {
              klineData = await strategy.fetchEtfKLine(mapping.exchangeCode, SCAN_KLINE_PERIOD);
              klineMemo.set(mapping.exchangeCode, klineData);
            }
            if (!klineData || klineData.length < 5) continue;

            const patterns = detectPatterns(klineData);
            const highConfPatterns = patterns.filter((p) => p.confidence * 100 >= rule.threshold);
            if (highConfPatterns.length > 0) {
              triggered = true;
              reason = `检测到 ${highConfPatterns.length} 个 K 线形态：${formatPatternsSummary(highConfPatterns, klineData)}`;
            }
          } catch {
            continue; // K 线获取失败，跳过
          }
          break;
        }
        case "trend": {
          // SW 未注入 computeTrendScore → 优雅跳过（不报错、不误触发）
          if (!strategy.computeTrendScore) continue;
          const trend = await strategy.computeTrendScore(h, strategy.etfMappings);
          if (!trend) continue; // 无法取得 K 线则跳过

          const score = trend.score;
          if (compare(score, rule.comparator, rule.threshold)) {
            triggered = true;
            const verb = rule.action === "buy" ? "加仓" : "减仓/止盈";
            reason = `趋势评分 ${score} ${cmpLabel(rule.comparator)} ${rule.threshold} → 建议${verb}`;
            if (trend.lowConfidence) {
              reason += "（基于净值走势，无盘中区间，信号置信度较低，建议切换 ETF 真实 K 线复核）";
            }
          }
          break;
        }
      }

      if (triggered) {
        alerts.push({
          id: crypto.randomUUID(),
          fundCode: h.code,
          fundName: h.name || h.code,
          ruleId: rule.id,
          ruleType: rule.type,
          action: rule.action,
          shares: rule.shares,
          currentNAV: nav,
          costNAV,
          returnRate: effectiveReturnRate,
          totalPnl,
          dailyChange: q.dailyChange,
          reason,
          triggeredAt: now,
          executed: false,
          dismissed: false,
        });
      }
    }
  }

  return alerts;
}

// ─── 纯工具函数（原 plans.ts 本地实现，提取为共享） ─────────

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case "lt":
      return value < threshold;
    case "gt":
      return value > threshold;
    case "lte":
      return value <= threshold;
    case "gte":
      return value >= threshold;
  }
}

export function cmpLabel(c: Comparator): string {
  return { lt: "<", gt: ">", lte: "≤", gte: "≥" }[c];
}
