/**
 * 统一决策引擎 — 融合 K线形态 / 技术指标 / 综合评分 / 命名策略
 *
 * 设计（借鉴 daily_stock_analysis 的算法决策结构）：
 *  1. 把四套来源归一化为 `AnalysisSignal`（方向 × 强度 × 置信度 × 新鲜度 × 类别）
 *  2. 分桶累加多头/空头有效功率 → 多空力量
 *  3. 按类别权重合成 0-100 综合评分（趋势 30 / 乖离 20 / 动量 15 / 量能 15 / MACD 10 / 形态 10）
 *  4. 一致性(agreement)检测多空冲突；趋势背景(MA 排列)修正评级
 *  5. 产出买入理由 + 风险因子双列表 + 人话总结
 *
 * 纯函数，不修改既有 signalEngine / klinePatterns / stockSdkIndicators / strategyLayer。
 *
 * @module decision/decisionEngine
 */

import type { KLineData } from '@/types'
import type { DetectedPattern } from '../klinePatterns'
import type { SignalResult, SignalContribution } from '../signalEngine'
import type { StockSdkIndicatorsResult, SignalEvent } from '../stockSdkIndicators'
import type { StrategyHit } from '../strategyLayer'
import type {
  AnalysisSignal,
  Decision,
  DecisionInputs,
  Direction,
  Rating,
  ReasonItem,
  SignalCategory,
} from './types'

// ─── 类别权重（同时也是评分维度，合计 100） ───────────
const CAT_WEIGHT: Record<SignalCategory, number> = {
  trend: 30,
  macd: 10,
  momentum: 15,
  bias: 20,
  volume: 15,
  pattern: 10,
}
const TOTAL_WEIGHT = Object.values(CAT_WEIGHT).reduce((a, b) => a + b, 0)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── 收集器：把各来源归一化为 AnalysisSignal ───────────

/** K 线形态 → 信号（依据形态在 K 线序列中的新近度衰减） */
function collectPatternSignals(patterns: DetectedPattern[], klines: KLineData[]): AnalysisSignal[] {
  const n = klines.length
  return patterns.map((p) => {
    const recency = Math.max(0, n - 1 - p.index)
    const freshness = clamp(1 - recency / 10, 0.3, 1)
    return {
      id: `pattern:${p.type}:${p.index}`,
      label: p.description,
      direction: p.direction === 'bullish' ? 'bull' : p.direction === 'bearish' ? 'bear' : 'neutral',
      strength: p.confidence,
      confidence: p.confidence,
      freshness,
      category: 'pattern',
      source: 'K线形态',
      detail: p.description,
    }
  })
}

const EVENT_CATEGORY: Record<string, SignalCategory> = {
  ma_golden_cross: 'trend',
  ma_death_cross: 'trend',
  macd_golden_cross: 'macd',
  macd_death_cross: 'macd',
  kdj_golden_cross: 'momentum',
  kdj_death_cross: 'momentum',
  kdj_overbought: 'momentum',
  kdj_oversold: 'momentum',
  rsi_overbought: 'momentum',
  rsi_oversold: 'momentum',
  boll_break_upper: 'momentum',
  boll_break_lower: 'momentum',
  sar_reversal_up: 'trend',
  sar_reversal_down: 'trend',
}

/** 指标事件（calcSignals 产出，已按日期倒序） → 信号 */
function collectIndicatorEventSignals(signals: SignalEvent[], klines: KLineData[]): AnalysisSignal[] {
  const dateIndex = new Map(klines.map((k, i) => [k.date, i]))
  const n = klines.length
  return signals.map((s, rank) => {
    const idx = dateIndex.get(s.date)
    const recency = idx !== undefined ? Math.max(0, n - 1 - idx) : 0
    const freshness = clamp(1 - recency / 12, 0.3, 1) * (1 - rank * 0.04)
    return {
      id: `ind:${s.type}:${s.date}`,
      label: s.label,
      direction: s.direction === 'up' ? 'bull' : s.direction === 'down' ? 'bear' : 'neutral',
      strength: 0.7,
      confidence: 0.7,
      freshness: clamp(freshness, 0.2, 1),
      category: EVENT_CATEGORY[s.type] ?? 'momentum',
      source: '技术指标',
      detail: s.label,
    }
  })
}

/** 指标快照读数（KDJ/WR/CCI/BIAS/SAR 当前状态） → 信号（含乖离独立风险维度） */
function collectIndicatorSnapshotSignals(ind: StockSdkIndicatorsResult): AnalysisSignal[] {
  const out: AnalysisSignal[] = []
  const snap = ind.latest
  if (snap.kdj?.k !== null && snap.kdj?.k !== undefined) {
    const k = snap.kdj.k
    if (k > 80) out.push(mk('ind:kdj:overbought', `KDJ.K=${k.toFixed(1)} 超买`, 'bear', 0.6, 'momentum', '技术指标'))
    else if (k < 20) out.push(mk('ind:kdj:oversold', `KDJ.K=${k.toFixed(1)} 超卖`, 'bull', 0.6, 'momentum', '技术指标'))
  }
  if (snap.cci !== null && snap.cci !== undefined) {
    const c = snap.cci
    if (c > 100) out.push(mk('ind:cci:overbought', `CCI=${c.toFixed(1)} 超买`, 'bear', 0.55, 'momentum', '技术指标'))
    else if (c < -100) out.push(mk('ind:cci:oversold', `CCI=${c.toFixed(1)} 超卖`, 'bull', 0.55, 'momentum', '技术指标'))
  }
  if (snap.sar?.trend === 1) out.push(mk('ind:sar:up', 'SAR 多头趋势', 'bull', 0.6, 'trend', '技术指标'))
  else if (snap.sar?.trend === -1) out.push(mk('ind:sar:down', 'SAR 空头趋势', 'bear', 0.6, 'trend', '技术指标'))
  // 乖离率：偏离均线过远 → 独立风险维度
  if (snap.bias) {
    for (const [key, val] of Object.entries(snap.bias)) {
      if (val === null || val === undefined) continue
      if (val > 8) out.push(mk(`ind:bias:${key}`, `乖离${key}=${val.toFixed(1)}% 过高，严禁追高`, 'bear', clamp(val / 20, 0.3, 0.9), 'bias', '技术指标'))
      else if (val < -8) out.push(mk(`ind:bias:${key}`, `乖离${key}=${val.toFixed(1)}% 过低，存在修复空间`, 'bull', clamp(-val / 20, 0.3, 0.9), 'bias', '技术指标'))
    }
  }
  return out
}

function mk(
  id: string,
  label: string,
  direction: Direction,
  strength: number,
  category: SignalCategory,
  source: string,
): AnalysisSignal {
  return { id, label, direction, strength, confidence: 0.7, freshness: 1, category, source, detail: label }
}

/** 综合评分贡献 → 信号（描述"当前状态"，新鲜度=1） */
function collectScoreSignals(result: SignalResult): AnalysisSignal[] {
  const catOf: Record<string, SignalCategory> = {
    maTrend: 'trend',
    macdCross: 'macd',
    rsi: 'momentum',
    bollinger: 'momentum',
    klinePattern: 'pattern',
    volume: 'volume',
  }
  return result.contributions
    .filter((c: SignalContribution) => c.score !== 0)
    .map((c) => ({
      id: `score:${c.key}`,
      label: c.label,
      direction: (c.score > 0 ? 'bull' : 'bear') as Direction,
      strength: clamp(Math.abs(c.score) / 10, 0.1, 1),
      confidence: 0.7,
      freshness: 1,
      category: catOf[c.key] ?? 'momentum',
      source: '综合评分',
      detail: c.detail,
    }))
}

/** 命名策略 → 信号 */
function collectStrategySignals(strategies: StrategyHit[]): AnalysisSignal[] {
  return strategies.map((s) => ({
    id: `strat:${s.id}`,
    label: s.name,
    direction: s.direction,
    strength: s.confidence,
    confidence: s.confidence,
    freshness: 1,
    category: s.category,
    source: '策略',
    detail: s.detail,
  }))
}

// ─── 融合 ─────────────────────────────────────────

const RATING_META: Record<Rating, { label: string; color: 'up' | 'down' | 'neutral' }> = {
  strong_buy: { label: '强烈买入', color: 'up' },
  buy: { label: '买入', color: 'up' },
  hold: { label: '持有 / 观望', color: 'neutral' },
  reduce: { label: '减仓 / 观望', color: 'down' },
  sell: { label: '卖出', color: 'down' },
  strong_sell: { label: '强烈卖出', color: 'down' },
}

/**
 * 融合四套分析为单一决策建议。
 */
export function buildDecision(inputs: DecisionInputs): Decision {
  const { klines, patterns, signalResult, ind, strategies, lowConfidence } = inputs

  const signals: AnalysisSignal[] = [
    ...collectPatternSignals(patterns, klines),
    ...collectIndicatorEventSignals(ind.signals, klines),
    ...collectIndicatorSnapshotSignals(ind),
    ...(signalResult ? collectScoreSignals(signalResult) : []),
    ...collectStrategySignals(strategies),
  ]

  // 分维度带权累加（有效功率 = 方向 × 强度 × 置信度 × 新鲜度）
  const axisNet: Record<SignalCategory, number> = {
    trend: 0, macd: 0, momentum: 0, bias: 0, volume: 0, pattern: 0,
  }
  let bullPower = 0
  let bearPower = 0

  for (const s of signals) {
    if (s.direction === 'neutral') continue
    const sign = s.direction === 'bull' ? 1 : -1
    const eff = sign * s.strength * s.confidence * s.freshness
    axisNet[s.category] += eff
    const weighted = Math.abs(eff) * CAT_WEIGHT[s.category]
    if (sign > 0) bullPower += weighted
    else bearPower += weighted
  }

  // 0-100 综合评分（每维度先夹到 [-1,1] 再按权重合成）
  let scoreRaw = 0
  for (const cat of Object.keys(axisNet) as SignalCategory[]) {
    scoreRaw += CAT_WEIGHT[cat] * clamp(axisNet[cat], -1, 1)
  }
  let score = Math.round(50 + 50 * (scoreRaw / TOTAL_WEIGHT))
  score = clamp(score, 0, 100)

  const total = bullPower + bearPower
  const bullRatio = total > 0 ? bullPower / total : 0.5
  // 冲突：多空力量相当（弱势一方 ≥ 强势一方的 40%）
  const conflict = total > 0 && Math.min(bullPower, bearPower) >= 0.4 * Math.max(bullPower, bearPower)

  // 趋势背景：空头排列 → 修正评级（不追高）
  let trendBearish = false
  const maContrib = signalResult?.contributions.find((c) => c.key === 'maTrend')
  if (maContrib && maContrib.score < -3) trendBearish = true
  if (ind.signals.some((s) => s.type === 'ma_death_cross' || s.type === 'macd_death_cross')) trendBearish = true
  if (ind.latest.sar?.trend === -1) trendBearish = true

  // 净值模式置信度降级：评分向 50 收敛
  const isLowConf = lowConfidence ?? !ind.ohlcAvailable
  if (isLowConf) score = Math.round(50 + (score - 50) * 0.7)

  // 评级：先按分数，再叠加「趋势背景 / 多空冲突」上下文修正
  let rating: Rating
  if (trendBearish || conflict) {
    // 风险上下文：不追高、偏防守
    if (score >= 60) rating = 'hold'
    else if (score >= 45) rating = 'reduce'
    else if (score >= 30) rating = 'sell'
    else rating = 'strong_sell'
  } else {
    if (score >= 75 && bullRatio >= 0.6) rating = 'strong_buy'
    else if (score >= 60) rating = 'buy'
    else if (score >= 45) rating = 'hold'
    else if (score >= 30) rating = 'reduce'
    else rating = 'sell'
  }

  // 理由：按有效功率排序取 top
  const ranked = signals
    .filter((s) => s.direction !== 'neutral')
    .map((s) => ({
      s,
      w: (s.direction === 'bull' ? 1 : -1) * s.strength * s.confidence * s.freshness,
    }))
  const bulls = ranked.filter((r) => r.w > 0).sort((a, b) => b.w - a.w).slice(0, 4)
  const bears = ranked.filter((r) => r.w < 0).map((r) => ({ s: r.s, w: -r.w })).sort((a, b) => b.w - a.w).slice(0, 4)
  const toReason = (r: { s: AnalysisSignal; w: number }): ReasonItem => ({
    label: r.s.label,
    detail: r.s.detail ?? r.s.label,
    category: r.s.category,
    weight: r.w,
  })
  const bullReasons = bulls.map(toReason)
  const bearReasons = bears.map(toReason)

  const summary = buildSummary(rating, conflict, trendBearish, bullReasons, bearReasons, isLowConf)

  return {
    rating,
    ratingLabel: RATING_META[rating].label,
    ratingColor: RATING_META[rating].color,
    score,
    bullPower,
    bearPower,
    bullRatio,
    agreement: bullRatio,
    conflict,
    lowConfidence: isLowConf,
    bullReasons,
    bearReasons,
    strategies,
    trendBearish,
    summary,
  }
}

function buildSummary(
  rating: Rating,
  conflict: boolean,
  trendBearish: boolean,
  bulls: ReasonItem[],
  bears: ReasonItem[],
  lowConf: boolean,
): string {
  const parts: string[] = []
  if (conflict) {
    const b = bulls[0]?.label ?? '多方信号'
    const r = bears[0]?.label ?? '空方信号'
    parts.push(`多空分歧较大：${b}（看多），但 ${r}（看空），信号可靠性下降`)
  }
  if (trendBearish && (rating === 'hold' || rating === 'reduce')) {
    parts.push('当前处于空头排列趋势背景下，反弹力度受限')
  }
  if (rating === 'strong_buy' || rating === 'buy') {
    parts.push(`综合看多，主要支撑：${bulls.slice(0, 2).map((x) => x.label).join('、') || '多指标共振'}`)
  } else if (rating === 'sell' || rating === 'strong_sell') {
    parts.push(`综合看空，主要压力：${bears.slice(0, 2).map((x) => x.label).join('、') || '多指标转弱'}`)
  } else {
    parts.push('方向尚不明朗，建议持有观望、不追高不杀跌')
  }
  if (lowConf) parts.push('（基于净值走势，无盘中区间，指标置信度较低，建议切换 ETF 真实 K 线复核）')
  return parts.join('；') + '。'
}
