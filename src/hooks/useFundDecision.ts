/**
 * useFundDecision — 包装决策引擎 buildDecision 的纯计算 Hook。
 *
 * 设计：完全复用 DecisionAdvisorCard 的计算逻辑（computeStockSdkIndicators →
 * evaluateStrategies → buildDecision），把「评分重算」收敛到一处，供 SOP 向导与
 * 决策卡共享，避免重复计算散落到多处。不修改 buildDecision 任何行为（blast radius 最小）。
 *
 * 输入直接来自 useFundDetail() 控制器字段；在 FundDetailProvider 子树内调用即可。
 *
 * @module hooks/useFundDecision
 */

import { useMemo } from "react";
import type { KLineData } from "@/types";
import type { DetectedPattern } from "@/services/klinePatterns";
import type { SignalResult } from "@/services/signalEngine";
import type { EmFactors, MarketRegime, Decision } from "@/services/decision/types";
import { computeStockSdkIndicators } from "@/services/stockSdkIndicators";
import { evaluateStrategies } from "@/services/strategyLayer";
import { buildDecision } from "@/services/decision/decisionEngine";
import { computeNavFactors } from "@/services/decision/navFactors";
import type { NavFactors } from "@/services/decision/types";

export interface UseFundDecisionInput {
  klines: KLineData[];
  patterns: DetectedPattern[];
  signalResult: SignalResult | null;
  /** 是否场内 ETF 真实 K 线；false 表示净值走势（置信度低） */
  isRealKline?: boolean;
  /** 东财交叉截面因子（overlay）；缺省表示未接入 */
  em?: EmFactors;
  /** 市场 regime（剥离 beta 伪信号）；缺省表示未计算 */
  regime?: MarketRegime;
  /** 联接基金自身 NAV 序列（仅 isRealKline 场景传入，用于算跟踪误差折扣） */
  navKlines?: KLineData[];
}

export interface UseFundDecisionResult {
  /** 融合后的决策建议；K 线为空时为 null */
  decision: Decision | null;
  /** NAV 原生因子（仅净值模式可用，供 UI 展示状态） */
  nav: NavFactors | undefined;
}

export function useFundDecision(input: UseFundDecisionInput): UseFundDecisionResult {
  const { klines, patterns, signalResult, isRealKline = true, em, regime, navKlines } = input;

  // 净值基金：用 NAV 收盘价序列算原生因子（纯本地），给自身方向性依据
  const nav = useMemo(
    () => (!isRealKline && klines.length > 0 ? computeNavFactors(klines) : undefined),
    [klines, isRealKline],
  );

  const decision = useMemo<Decision | null>(() => {
    if (klines.length === 0) return null;
    const ind = computeStockSdkIndicators(klines);
    const strategies = evaluateStrategies(klines, ind);
    return buildDecision({
      klines,
      patterns,
      signalResult,
      ind,
      strategies,
      lowConfidence: !isRealKline,
      nav,
      em,
      regime,
      navKlines,
    });
  }, [klines, patterns, signalResult, isRealKline, nav, em, regime, navKlines]);

  return { decision, nav };
}
