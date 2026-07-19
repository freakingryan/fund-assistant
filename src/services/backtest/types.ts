/**
 * 评分回测 — 类型定义
 *
 * 每只基金每日收盘评分快照，用于验证决策引擎（0-100 评分 + 买/持/卖建议）的真实准确率。
 *
 * @module backtest/types
 */

import type { Rating, SignalCategory, Direction } from '@/services/decision/types'

/** 决策建议的回测口径：买 / 持 / 卖（由 rating 归一化） */
export type Recommendation = 'buy' | 'hold' | 'sell'

/**
 * 回测结果：
 * - pending：尚未回填次日数据（或无可用的下一交易日 K 线）
 * - correct：方向与建议一致（买→涨 / 卖→跌）
 * - wrong：方向与建议相反
 * - neutral：持有建议（无方向性押注）或涨跌幅为 0
 * - unknown：无法判定（如缺失收盘值）
 */
export type Outcome = 'pending' | 'correct' | 'wrong' | 'neutral' | 'unknown'

/** 收盘值来源 */
export type ValueSource = 'etf' | 'nav' | 'unknown'

export interface ReasonSnapshot {
  label: string
  detail: string
  category: SignalCategory
  weight: number
}

export interface StrategySnapshot {
  id: string
  name: string
  direction: Direction
}

/**
 * 单日评分快照（主键 id = `${fundCode}-${date}`）
 */
export interface ScoreSnapshot {
  id: string
  fundCode: string
  fundName: string
  /** 记录日历日（YYYY-MM-DD）。自动采集时经 isMarketClosed 门禁，手动采集用当天 */
  date: string
  /** 实际收盘数据所属交易日（K 线最后一根的日期），回填时以它找下一交易日 */
  asOfDate: string
  /** 场内 ETF 代码（若有），回填时据此拉取真实 K 线；为空则走基金净值 K 线 */
  etfCode: string | null

  // ── 决策结果（来自 buildDecision） ──
  score: number
  rating: Rating
  ratingLabel: string
  recommendation: Recommendation
  bullPower: number
  bearPower: number
  bullRatio: number
  agreement: number
  conflict: boolean
  lowConfidence: boolean
  bullReasons: ReasonSnapshot[]
  bearReasons: ReasonSnapshot[]
  strategiesHit: StrategySnapshot[]
  summary: string

  // ── 收盘值 ──
  closeValue: number | null
  valueSource: ValueSource

  // ── 次日回填 ──
  nextDate: string | null
  nextValue: number | null
  /** 次日相对当日收盘的涨跌幅（%） */
  nextChangePct: number | null
  outcome: Outcome

  createdAt: number
  updatedAt: number
}
