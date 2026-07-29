/**
 * 运行时 AI 解释层（T4）
 *
 * 定位：**只解释、不改算法**。把决策引擎 / 形态检测的结构化输出，
 * 结合市场维度上下文（资金面 / 板块 / 排名 / 大盘 / 量价），翻译成
 * 普通人能看懂的「人话 + 跨维度综合研判」。
 *
 * 两入口：
 * - T4.1 `adjudicateDecision`：决策卡「AI 综合研判」——解释引擎决策。
 * - T4.2 `explainPattern`：K 线形态卡「AI 形态解读」——解释检测到的形态。
 *
 * 设计不变量（防幻觉 / 防臆造）：
 * - 完全复用 services/ai.ts 的 `getDefaultAI` / `callAI`（浏览器直连，零后端，沿用设置页已配 provider/apiKey）。
 * - 未配置 AI 时抛 `NoAIConfiguredError`（UI 据此引导去设置页）。
 * - Prompt 仅由「传入的结构化字段」拼装，前端不注入任何非输入数据；
 *   并显式强约束 LLM「只基于给定数据、不编造」。
 * - 两个 prompt builder 均导出，便于无密钥静态校验「无臆造」。
 *
 * @module aiAdvisor
 */

import { callAI, getDefaultAI } from "@/services/ai";
import { NoAIConfiguredError } from "@/services/backtest/aiAnalysis";
import type { Decision, EmFactors, MarketRegime } from "@/services/decision/types";
import type { KLineData } from "@/types";
import type { DetectedPattern } from "@/services/klinePatterns";

/** AI 解释结果（统一返回结构，供卡片渲染） */
export interface AiAdvisoryResult {
  /** 解释正文（已 trim） */
  text: string;
  /** 是否真正调用了 AI 并拿到内容 */
  usedAI: boolean;
  /** 调用失败时的错误信息（usedAI=false 时出现） */
  error?: string;
}

/**
 * 市场快照：从卡片本地组装（em / regime + 近期量价），不联网，仅含真实字段。
 * 这是 T4.1 区别于「裸 decision」的「跨维度语境」来源。
 */
export interface MarketSnapshot {
  em?: EmFactors | null;
  regime?: MarketRegime | null;
  /** 近期量价（由 klines 本地计算的少量统计，避免把整条 klines 塞进 prompt） */
  recent?: {
    lastClose: number;
    prevClose: number;
    /** 最近一根较上一根涨跌幅 % */
    changePct: number;
    /** 整段 klines 区间累计涨跌幅 % */
    periodReturnPct: number;
    avgVolume: number;
    lastVolume: number;
  } | null;
}

/**
 * 组装市场快照（纯本地，不联网）。
 * 只统计少量真实量价字段，避免 prompt 过长与注入非输入信息。
 */
export function buildMarketSnapshot(
  em?: EmFactors | null,
  regime?: MarketRegime | null,
  klines?: KLineData[],
): MarketSnapshot {
  let recent: MarketSnapshot["recent"] = null;
  if (klines && klines.length >= 2) {
    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const first = klines[0];
    const volSum = klines.reduce((s, k) => s + (k.volume || 0), 0);
    recent = {
      lastClose: last.close,
      prevClose: prev.close,
      changePct: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
      periodReturnPct: first.close ? ((last.close - first.close) / first.close) * 100 : 0,
      avgVolume: volSum / klines.length,
      lastVolume: last.volume,
    };
  }
  return { em: em ?? null, regime: regime ?? null, recent };
}

// ─────────────────────────────────────────────────────────────────────────────
// T4.1 — 决策综合研判
// ─────────────────────────────────────────────────────────────────────────────

/** 把 decision + 市场快照压成 prompt 友好的纯数据对象（仅含真实字段） */
function decisionToCtx(decision: Decision, snapshot: MarketSnapshot) {
  return {
    decision: {
      action: decision.actionLabel,
      rating: decision.ratingLabel,
      score: decision.score,
      rawScore: decision.rawScore,
      adjustedScore: decision.adjustedScore,
      bullRatioPct: Number((decision.bullRatio * 100).toFixed(0)),
      signalType: decision.signalType,
      conflict: decision.conflict,
      trendBearish: decision.trendBearish,
      midTermDown: decision.midTermDown,
      midTermReturnPct: Number(decision.midTermReturnPct.toFixed(1)),
      lowConfidence: decision.lowConfidence,
      emDelta: decision.emDelta,
      navAvailable: decision.navAvailable,
      trackingErrorPct: decision.trackingErrorPct ?? null,
      summary: decision.summary,
      bullReasons: decision.bullReasons.map((r) => r.detail),
      bearReasons: decision.bearReasons.map((r) => r.detail),
      guardrails: decision.guardrails.map((g) => g.description),
      strategies: decision.strategies.map((s) => s.name),
      riskProfile: decision.riskProfile
        ? {
            volTier: decision.riskProfile.volTier,
            annualizedVol: decision.riskProfile.annualizedVol,
            maxDrawdown: decision.riskProfile.maxDrawdown,
            suggestedMaxPosition: decision.riskProfile.suggestedMaxPosition,
            stopLossPct: decision.riskProfile.stopLossPct,
          }
        : null,
    },
    market: {
      regime: snapshot.regime
        ? {
            trend: snapshot.regime.trend,
            momentum60: snapshot.regime.momentum60,
            maBull: snapshot.regime.maBull,
          }
        : null,
      em: snapshot.em
        ? {
            capitalFlow: snapshot.em.capitalFlow.available
              ? { combinedScore: snapshot.em.capitalFlow.combinedScore }
              : null,
            sector: snapshot.em.sector.available
              ? { combinedScore: snapshot.em.sector.combinedScore }
              : null,
            peerRank: snapshot.em.peerRank.available
              ? { percentile: snapshot.em.peerRank.percentile }
              : null,
          }
        : null,
      recent: snapshot.recent
        ? {
            lastClose: snapshot.recent.lastClose,
            changePct: Number(snapshot.recent.changePct.toFixed(2)),
            periodReturnPct: Number(snapshot.recent.periodReturnPct.toFixed(2)),
            lastVolume: snapshot.recent.lastVolume,
            avgVolume: snapshot.recent.avgVolume,
          }
        : null,
    },
  };
}

/** 构造 T4.1 研判 Prompt（导出以便无密钥静态校验「无臆造」） */
export function buildAdjudicationPrompt(decision: Decision, snapshot: MarketSnapshot): string {
  const ctx = decisionToCtx(decision, snapshot);
  return `你是一位严谨的基金/ETF 投资决策解释助手。下面是一套本地量化决策引擎对某一标的最新给出的结构化决策结果，以及该标的的市场维度上下文快照（资金面/板块/排名/大盘/量价）。

## 决策引擎结构化输出（实算结果，非预测）
${JSON.stringify(ctx.decision, null, 2)}

## 市场维度上下文快照（实算结果，非预测）
${JSON.stringify(ctx.market, null, 2)}

## 你的任务
用通俗易懂的中文，把以上"机器打分"翻译成"人话"，并做跨维度综合研判：

1. **一句话结论**：结合动作(${decision.actionLabel})与多空力量(${ctx.decision.bullRatioPct}% 多头)，用一句大白话说明"引擎到底想表达什么"。
2. **为什么是这个结果**：串联看多理由(bullReasons)与看空理由(bearReasons)，并说明护栏(guardrails)如何把原始评分/动作做了降级（如有）。
3. **跨维度综合**：把资金面(em.capitalFlow)、板块(em.sector)、同类排名(em.peerRank)、大盘状态(regime)、中期趋势(midTermDown/midTermReturnPct) 纳入语境，说明它们如何支持或削弱当前决策。
4. **主要风险**：点出最值得关注的 1-3 个风险信号或信号冲突(conflict)。
5. **普通人能看懂的总结**：不超过 3 句，不出现专业黑话。

## 硬性约束（违反即视为错误）
- 只能基于上面给定的结构化字段作答，不得编造任何数值、新闻、目标价、资金金额、机构动向或任何未提供的数据。
- 若某维度未提供（如 em 为 null / regime 缺失），请明确写"该维度数据缺失，未纳入研判"，不要假设其存在或赋值。
- 这是"解释"，不是"荐股"：不要给出具体买卖金额、仓位比例建议（riskProfile 里的参考值除外），也不要保证收益。
- 保持客观，不夸大、不渲染情绪。`;
}

/**
 * T4.1 决策综合研判：把引擎结构化输出 + 市场快照解释为人话 + 跨维度综合。
 * @throws NoAIConfiguredError 未配置 AI（UI 据此引导去设置页）；其他错误返回 { usedAI:false, error }
 */
export async function adjudicateDecision(
  decision: Decision,
  snapshot: MarketSnapshot,
): Promise<AiAdvisoryResult> {
  const ai = getDefaultAI();
  if (!ai || !ai.apiKey) throw new NoAIConfiguredError();

  const prompt = buildAdjudicationPrompt(decision, snapshot);
  try {
    const text = await callAI(ai, [{ role: "user", content: prompt }]);
    return { text: text.trim(), usedAI: true };
  } catch (e) {
    return { text: "", usedAI: false, error: e instanceof Error ? e.message : "AI 调用失败" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T4.2 — K 线形态语义解读
// ─────────────────────────────────────────────────────────────────────────────

/** 把 patterns + 近期量价压成 prompt 友好的纯数据对象（仅含真实字段） */
function patternsToCtx(klines: KLineData[], patterns: DetectedPattern[]) {
  const recent = klines.slice(-20);
  return {
    patterns: patterns.map((p) => ({
      name: p.type,
      direction: p.direction,
      confidencePct: Number((p.confidence * 100).toFixed(0)),
      date: klines[p.index]?.date ?? null,
      description: p.description,
      isMultiCandle: p.isMultiCandle,
      candleCount: p.candleCount,
    })),
    recentKline: recent.map((k, i) => {
      const prev = recent[i - 1];
      const changePct = prev?.close ? ((k.close - prev.close) / prev.close) * 100 : 0;
      return {
        date: k.date,
        open: k.open,
        close: k.close,
        high: k.high,
        low: k.low,
        volume: k.volume,
        changePct: Number(changePct.toFixed(2)),
      };
    }),
  };
}

/** 构造 T4.2 形态解读 Prompt（导出以便无密钥静态校验「无臆造」） */
export function buildPatternExplanationPrompt(
  klines: KLineData[],
  patterns: DetectedPattern[],
): string {
  const ctx = patternsToCtx(klines, patterns);
  return `你是一位严谨的 K 线技术分析解释助手。下面是一套本地形态检测算法在某标的真实 K 线上识别出的形态列表，以及该标的近期的量价上下文。

## 算法检测到的形态（实算结果）
${JSON.stringify(ctx.patterns, null, 2)}

## 近期量价上下文（实算结果，最近约 20 根 K 线）
${JSON.stringify(ctx.recentKline, null, 2)}

## 你的任务
用通俗易懂的中文，对检测到的形态做"语义解读"，帮助用户理解这些形态在当前量价背景下意味着什么：

1. **整体形态语境**：综合这些形态，当前价格处在什么技术状态（如筑底、反弹、震荡、见顶等）。
2. **关键形态逐个解读**：挑最重要的 2-4 个形态，用大白话说明它的市场含义（谁在主导：买方/卖方），以及可能的发展。
3. **形态信号的局限性（重要）**：结合近期量价上下文，说明为什么某个"看涨形态"在当前背景下可能只是"反弹"而非"反转"，以及需要哪些条件确认才能视为趋势信号。
4. **量价配合**：近期成交量相对均量是否放大/萎缩？量价是否背离？
5. **普通人能看懂的总结**：不超过 3 句。

## 硬性约束（违反即视为错误）
- 只能基于上面给定的形态与量价数据作答，不得编造形态名称、新闻、消息面、目标价或任何未提供的数据。
- 若某形态描述为空或未提供，请如实说明，不要脑补。
- 这是"形态语义解读"，不是"荐股"：不要给出具体买卖金额或保证收益。
- 保持客观，明确标注"形态信号只是概率，须结合更多维度确认"。`;
}

/**
 * T4.2 K 线形态解读：把检测到的形态 + 量价上下文喂 LLM 做可读解释。
 * @throws NoAIConfiguredError 未配置 AI（UI 据此引导去设置页）；其他错误返回 { usedAI:false, error }
 */
export async function explainPattern(
  klines: KLineData[],
  patterns: DetectedPattern[],
): Promise<AiAdvisoryResult> {
  const ai = getDefaultAI();
  if (!ai || !ai.apiKey) throw new NoAIConfiguredError();

  const prompt = buildPatternExplanationPrompt(klines, patterns);
  try {
    const text = await callAI(ai, [{ role: "user", content: prompt }]);
    return { text: text.trim(), usedAI: true };
  } catch (e) {
    return { text: "", usedAI: false, error: e instanceof Error ? e.message : "AI 调用失败" };
  }
}
