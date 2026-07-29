/**
 * 统一决策引擎 — 公共类型
 *
 * 把项目里三套割裂的分析（klinePatterns 形态 / signalEngine 评分 / stockSdkIndicators 指标）
 * 以及本地策略层（strategyLayer）的输出，归一化为同一个 `AnalysisSignal` 原语，
 * 再由 decisionEngine 融合成用户可读、可解释的 `Decision`。
 *
 * @module decision/types
 */

import type { DetectedPattern } from "../klinePatterns";
import type { SignalResult } from "../signalEngine";
import type { StockSdkIndicatorsResult } from "../stockSdkIndicators";
import type { StrategyHit } from "../strategyLayer";
export type { NavFactors } from "./navFactors";
export type { MarketRegime } from "./regimeFactor";
export type { EmFactors } from "./eastmoneyFactors";

/** 信号类别（同时作为评分维度，权重见 decisionEngine.ts） */
export type SignalCategory =
  | "trend" // 趋势（MA 排列 / 趋势类策略）
  | "macd" // MACD
  | "momentum" // 动量（RSI/KDJ/WR/CCI/ROC）
  | "bias" // 乖离率（独立风险维度）
  | "volume" // 量能
  | "pattern" // K 线形态
  | "navmom" // 净值动量（NAV 专属，仅净值模式计入基础加权）
  | "capitalflow" // 东财资金面（overlay，不计入基础加权）
  | "sector" // 东财板块赛道（overlay，不计入基础加权）
  | "peer"; // 东财同类排名（overlay，不计入基础加权）

export type Direction = "bull" | "bear" | "neutral";

/** 统一信号原语：三套分析 + 策略层都归一化成它 */
export interface AnalysisSignal {
  id: string;
  label: string;
  direction: Direction;
  /** 强度 0~1（方向幅度） */
  strength: number;
  /** 置信度 0~1 */
  confidence: number;
  /** 新鲜度 0~1：越靠近当前越高，衰减久远信号 */
  freshness: number;
  category: SignalCategory;
  /** 来源（用于展示：K线形态 / 技术指标 / 综合评分 / 策略） */
  source: string;
  detail?: string;
}

/** 决策理由条目（买入理由 / 风险因子的统一结构） */
export interface ReasonItem {
  label: string;
  detail: string;
  category: SignalCategory;
  /** 有效功率（带符号），用于排序 */
  weight: number;
}

export type Rating = "strong_buy" | "buy" | "hold" | "reduce" | "strong_sell";

/**
 * 信号语义类别：
 * - trend：趋势行情（中期上行 + 顺势动量），可给趋势买入；
 * - reversion：短期超卖反弹（非趋势确认），评级上限持有，不作趋势买入信号。
 */
export type SignalType = "trend" | "reversion";

/**
 * 决策动作（8 态，移植自 DSA DecisionSignal）——
 * 相比 5 态 `Rating` 更细粒度，并引入 watch/avoid/alert 等护栏/特殊态。
 * `buy/add/hold/reduce/sell` 由评分校准得到；`watch/avoid/alert` 由护栏或数据缺失态产生。
 */
export type DecisionAction =
  | "buy" // 买入
  | "add" // 加仓
  | "hold" // 持有
  | "watch" // 观察（信号不足/分歧，暂不动）
  | "reduce" // 减仓
  | "sell" // 卖出
  | "avoid" // 回避（数据不足，无法决策）
  | "alert"; // 预警（需关注）

/** 护栏原因：解释为何从 raw_action 调整为 final_action（含中性动作的显式理由） */
export interface GuardrailReason {
  kind:
    | "low_confidence"
    | "conflict"
    | "trend_bearish"
    | "regime"
    | "data_missing"
    | "neutral_mandated"
    | "mid_term_down"
    | "capital_divergence"
    | "sector_headwind"
    | "reversion_label";
  /** 中文解释（直接面向用户/模型） */
  description: string;
}

/** 融合后的决策建议 */
export interface Decision {
  rating: Rating;
  ratingLabel: string;
  /** 评级配色语义：涨红跌绿、中性 */
  ratingColor: "up" | "down" | "neutral";
  /** 综合评分 0~100 */
  score: number;
  /** 校准：加权合成后的纯分（置信压缩 / 东财叠加 / regime 折扣之前） */
  rawScore: number;
  /** 校准：最终评分（已含全部折扣），即 display score */
  adjustedScore: number;
  /** 校准：由 rawScore 经分档得到的原始 8 态动作（未施加护栏） */
  rawAction: DecisionAction;
  /** 校准：施加护栏后的最终 8 态动作（决策出口） */
  finalAction: DecisionAction;
  /** finalAction 中文标签 */
  actionLabel: string;
  /** finalAction 配色语义：涨红跌绿、中性 */
  actionColor: "up" | "down" | "neutral";
  /** 护栏原因列表（数据降级 → 决策降级 + 显式原因）；空表示评分与动作一致 */
  guardrails: GuardrailReason[];
  bullPower: number;
  bearPower: number;
  /** 多头力量占比 0~1 */
  bullRatio: number;
  /** 多空一致性 0~1（= bullRatio） */
  agreement: number;
  /** 是否存在显著多空冲突（分歧大） */
  conflict: boolean;
  /** 净值模式（无真实 OHLC），置信度降级 */
  lowConfidence: boolean;
  bullReasons: ReasonItem[];
  bearReasons: ReasonItem[];
  strategies: StrategyHit[];
  /** 当前是否为空头排列趋势背景 */
  trendBearish: boolean;
  /** 信号语义类别：trend=趋势行情 / reversion=短期超卖反弹（非趋势确认） */
  signalType: SignalType;
  /** 中期（近三月）趋势是否仍处下行（收益<0 且无中期均线金叉） */
  midTermDown: boolean;
  /** 中期区间收益率（%）；midTermDown 判定依据 */
  midTermReturnPct: number;
  /** 人话总结（含冲突说明、理由串联） */
  summary: string;
  /** 东财叠加层对综合评分的调整量（有界 ±12；所有因子不可用时恒为 0） */
  emDelta: number;
  /** 是否施加了市场 regime 折扣（剥离 beta 伪信号）；false 表示未计算或中性市 */
  regimeAdjusted: boolean;
  /** NAV 原生因子是否生效（仅净值模式且样本充足时 available） */
  navAvailable: boolean;
}

/** 融合引擎输入 */
export interface DecisionInputs {
  klines: import("@/types").KLineData[];
  patterns: DetectedPattern[];
  signalResult: SignalResult | null;
  ind: StockSdkIndicatorsResult;
  strategies: StrategyHit[];
  /** 净值模式（无真实 OHLC）时置信度降级 */
  lowConfidence?: boolean;
  /** NAV 原生因子（净值基金专属；available 时计入基础加权 navmom） */
  nav?: NavFactors;
  /** 市场 regime（沪深300 状态；用于剥离 beta 伪信号） */
  regime?: MarketRegime;
  /** 东财交叉截面因子（overlay 叠加层；不可用时 available:false → 增量 0，不影响评分） */
  em?: EmFactors;
}
