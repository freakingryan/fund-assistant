/**
 * 评分回测 — 类型定义
 *
 * 每只基金每日收盘评分快照，用于验证决策引擎（0-100 评分 + 买/持/卖建议）的真实准确率。
 *
 * @module backtest/types
 */

import type { Rating, SignalCategory, Direction } from '@/services/decision/types'
import type { BucketStat } from './stats'

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
  /** 是否盘中临时快照：盘中采集的基准价不可靠，盘后基金数据公布后会被准确数据覆盖 */
  provisional: boolean

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

  // ── 同类排名（东财增强，门控；enabled=false 时为 null） ──
  /** 同类近三月排名百分位(%)，越小越好（前 X%）；来自东财 fund.rankHistory 最新点 */
  rankPercentile?: number | null
  /** 同类近三月排名名次（越小越靠前） */
  rankValue?: number | null
  /** 同类基金总数 */
  rankTotal?: number | null

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

/**
 * 每日方向性准确率数据点（按快照 date 聚合）。
 * 用于「按日期回看」趋势曲线：观察算法逐日表现是否稳定。
 */
export interface DailyAccuracyPoint {
  /** 快照日历日 YYYY-MM-DD */
  date: string
  /** 当日方向性准确率 correct/(correct+wrong)，无方向性样本时为 null */
  accuracy: number | null
  /** 当日方向性样本数（correct+wrong） */
  sampleCount: number
  /** 当日已结算快照的平均次日涨跌幅(%) */
  avgNextChange: number | null
}

/**
 * AI 辅助分析结果（回测算法诊断 + 调参建议），可回看。
 * context 保留生成时的统计快照，便于复用与对比。
 */
export interface AiBacktestAnalysis {
  /** 主键：自增 id（时间戳-based） */
  id: string
  /** 生成日期 YYYY-MM-DD */
  date: string
  /** 使用的模型名（如 deepseek-chat） */
  model: string
  /** 使用的 provider（如 deepseek） */
  provider: string
  /** 生成时的统计上下文，供回看/复现 */
  context: {
    total: number
    settled: number
    directionalAccuracy: number | null
    buyHitRate: number | null
    sellHitRate: number | null
    avgNextByRec: Record<Recommendation, number | null>
    buckets: BucketStat[]
    daily: DailyAccuracyPoint[]
  }
  /** AI 诊断出的算法薄弱环节（中文短句） */
  weaknesses: string[]
  /** AI 给出的调参/策略建议（中文短句） */
  suggestions: string[]
  /** AI 总体结论摘要 */
  summary: string
  /** AI 原始返回文本 */
  raw: string
  createdAt: number
}
