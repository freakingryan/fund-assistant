/**
 * 统一决策引擎 — 公共类型
 *
 * 把项目里三套割裂的分析（klinePatterns 形态 / signalEngine 评分 / stockSdkIndicators 指标）
 * 以及本地策略层（strategyLayer）的输出，归一化为同一个 `AnalysisSignal` 原语，
 * 再由 decisionEngine 融合成用户可读、可解释的 `Decision`。
 *
 * @module decision/types
 */

import type { DetectedPattern } from '../klinePatterns'
import type { SignalResult } from '../signalEngine'
import type { StockSdkIndicatorsResult } from '../stockSdkIndicators'
import type { StrategyHit } from '../strategyLayer'

/** 信号类别（同时作为评分维度，权重见 decisionEngine.ts） */
export type SignalCategory =
  | 'trend' // 趋势（MA 排列 / 趋势类策略）
  | 'macd' // MACD
  | 'momentum' // 动量（RSI/KDJ/WR/CCI/ROC）
  | 'bias' // 乖离率（独立风险维度）
  | 'volume' // 量能
  | 'pattern' // K 线形态

export type Direction = 'bull' | 'bear' | 'neutral'

/** 统一信号原语：三套分析 + 策略层都归一化成它 */
export interface AnalysisSignal {
  id: string
  label: string
  direction: Direction
  /** 强度 0~1（方向幅度） */
  strength: number
  /** 置信度 0~1 */
  confidence: number
  /** 新鲜度 0~1：越靠近当前越高，衰减久远信号 */
  freshness: number
  category: SignalCategory
  /** 来源（用于展示：K线形态 / 技术指标 / 综合评分 / 策略） */
  source: string
  detail?: string
}

/** 决策理由条目（买入理由 / 风险因子的统一结构） */
export interface ReasonItem {
  label: string
  detail: string
  category: SignalCategory
  /** 有效功率（带符号），用于排序 */
  weight: number
}

export type Rating = 'strong_buy' | 'buy' | 'hold' | 'reduce' | 'strong_sell'

/** 融合后的决策建议 */
export interface Decision {
  rating: Rating
  ratingLabel: string
  /** 评级配色语义：涨红跌绿、中性 */
  ratingColor: 'up' | 'down' | 'neutral'
  /** 综合评分 0~100 */
  score: number
  bullPower: number
  bearPower: number
  /** 多头力量占比 0~1 */
  bullRatio: number
  /** 多空一致性 0~1（= bullRatio） */
  agreement: number
  /** 是否存在显著多空冲突（分歧大） */
  conflict: boolean
  /** 净值模式（无真实 OHLC），置信度降级 */
  lowConfidence: boolean
  bullReasons: ReasonItem[]
  bearReasons: ReasonItem[]
  strategies: StrategyHit[]
  /** 当前是否为空头排列趋势背景 */
  trendBearish: boolean
  /** 人话总结（含冲突说明、理由串联） */
  summary: string
}

/** 融合引擎输入 */
export interface DecisionInputs {
  klines: import('@/types').KLineData[]
  patterns: DetectedPattern[]
  signalResult: SignalResult | null
  ind: StockSdkIndicatorsResult
  strategies: StrategyHit[]
  /** 净值模式（无真实 OHLC）时置信度降级 */
  lowConfidence?: boolean
}
