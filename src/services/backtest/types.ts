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

/** 资金面聚合明细（单只重仓股/ETF 的贡献） */
export interface CapitalFlowBreakdownItem {
  symbol: string
  name?: string
  /** 占净值权重（0-1） */
  weight: number
  /** 主力净流入净占比(%)，近 5 日均值；null 表示未取得 */
  capitalPercent: number | null
  /** 北向持股变化(%)，最近两期对比；null 表示未取得 */
  northboundDeltaPct: number | null
}

/** 板块赛道强度聚合明细（单只重仓股/ETF 的贡献） */
export interface SectorStrengthBreakdownItem {
  symbol: string
  name?: string
  /** 占净值权重（0-1） */
  weight: number
  /** 所属行业板块当日平均涨跌幅(%)，null 表示未取得 */
  industryChangePercent: number | null
  /** 所属概念（赛道）板块当日平均涨跌幅(%)，null 表示未取得 */
  conceptChangePercent: number | null
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

  // ── 资金面（东财增强，门控；enabled=false 时为 null） ──
  /** 加权主力净流入分（0-100），来自重仓股/ETF 资金流向 */
  capitalScore?: number | null
  /** 加权北向增持分（0-100），来自重仓股北向持仓变化 */
  northboundScore?: number | null
  /** 资金面聚合明细（每只重仓股/ETF 的贡献） */
  capitalBreakdown?: CapitalFlowBreakdownItem[] | null

  // ── 板块赛道强度（东财增强，门控；enabled=false 时为 null） ──
  /** 综合板块赛道分（0-100）：行业+概念加权，来自重仓股/ETF 所属板块当日强度 */
  sectorScore?: number | null
  /** 板块赛道聚合明细（每只重仓股/ETF 所属板块的涨跌幅贡献） */
  sectorBreakdown?: SectorStrengthBreakdownItem[] | null

  // ── 次日回填 ──
  nextDate: string | null
  nextValue: number | null
  /** 次日相对当日收盘的涨跌幅（%） */
  nextChangePct: number | null
  outcome: Outcome

  createdAt: number
  updatedAt: number
}

/** 采集失败的数据源归属（用于标注"因某接口不可达而缺评分"） */
export type CaptureSource = 'eastmoney' | 'tencent' | 'unknown'

/** 单只基金当日未能生成评分的原因（数据接口不可达 / 无可用 K 线） */
export interface CaptureFailure {
  code: string
  name: string
  /** 该基金评分所依赖的主要数据源 */
  source: CaptureSource
  reason: string
}

/**
 * 一次采集运行的报告（主键 id = 日期 YYYY-MM-DD），
 * 记录哪些基金因数据源不可达而未能评分，供排行榜标注"未纳入评分"原因。
 */
export interface CaptureReport {
  id: string
  date: string
  /** 参与采集的持仓总数 */
  total: number
  /** 成功生成快照的数量 */
  ok: number
  failures: CaptureFailure[]
  createdAt: number
}
