/**
 * 多指标融合信号评分系统
 *
 * 将 K 线形态、技术指标（MA/MACD/RSI/Bollinger/成交量）的信号
 * 综合打分，判断当前多空强度。
 *
 * ══════════════════════════════════════════════════
 *  权重设计原则（可调，支持 AI 自动优化）
 * ══════════════════════════════════════════════════
 *  1. 趋势指标（MA、MACD）权重更高 → 占 40%
 *  2. 形态信号（K 线组合）次之     → 占 25%
 *  3. 震荡指标（RSI、BOLL 位置）   → 占 20%
 *  4. 量能指标（成交量均线）       → 占 15%
 *
 *  总分范围：-100 ~ +100
 *  +60 以上：强烈看多      +20~+60：偏多
 *  -20~+20：震荡/观望     -60~-20：偏空
 *  -60 以下：强烈看空
 * ══════════════════════════════════════════════════
 *
 * @module signalEngine
 */

import type { KLineData } from '@/types'
import { calculateAll, type TechnicalIndicators } from './technicalIndicators'
import { detectPatterns, type DetectedPattern } from './klinePatterns'

// ─── 权重配置（公开可见，支持 AI 调参） ─────────────

export interface SignalWeights {
  /** MA 均线排列 */
  maTrend: number
  /** MACD 金叉/死叉 */
  macdCross: number
  /** RSI 超买超卖 */
  rsi: number
  /** Bollinger 位置 */
  bollinger: number
  /** K 线形态 */
  klinePattern: number
  /** 成交量均线 */
  volume: number
}

/** 默认权重 */
export const DEFAULT_WEIGHTS: SignalWeights = {
  maTrend: 20,
  macdCross: 20,
  rsi: 10,
  bollinger: 10,
  klinePattern: 25,
  volume: 15,
}

/** 权重标签（中文描述） */
export const WEIGHT_LABELS: Record<keyof SignalWeights, string> = {
  maTrend: 'MA 均线趋势',
  macdCross: 'MACD 金叉/死叉',
  rsi: 'RSI 超买超卖',
  bollinger: '布林带位置',
  klinePattern: 'K 线形态',
  volume: '成交量均线',
}

// ─── 信号评分结果 ─────────────────────────────────

export interface SignalContribution {
  key: keyof SignalWeights
  label: string
  weight: number
  score: number      // 子项得分 -10~+10
  detail: string     // 信号原文
}

export interface SignalResult {
  /** 综合得分 -100~+100 */
  totalScore: number
  /** 方向判断 */
  direction: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish'
  /** 方向标签 */
  directionLabel: string
  /** 各信号贡献明细 */
  contributions: SignalContribution[]
  /** 当前置信度 */
  confidence: number
}

// ─── 子信号计算 ───────────────────────────────────

/** MA 均线信号：判断多头/空头排列 */
function scoreMATrend(technicals: TechnicalIndicators, latestIdx: number): { score: number; detail: string } {
  const { ma5, ma10, ma20, ma60 } = technicals.ma
  const c5 = ma5[latestIdx]
  const c10 = ma10[latestIdx]
  const c20 = ma20[latestIdx]
  const c60 = ma60[latestIdx]
  const valid = [c5, c10, c20, c60].filter((v) => v !== null) as number[]

  if (valid.length < 2) return { score: 0, detail: 'MA 数据不足' }

  // 多头排列: MA5 > MA10 > MA20 > MA60 (短期 > 长期)
  const bull = (c5 ?? 0) > (c10 ?? 0) && (c10 ?? 0) > (c20 ?? 0)
  // 空头排列: MA5 < MA10 < MA20 < MA60
  const bear = (c5 ?? 999) < (c10 ?? 0) && (c10 ?? 0) < (c20 ?? 0)

  if (bull) return { score: 8, detail: `多头排列 MA5(${(c5 ?? 0).toFixed(4)}) > MA10 > MA20` }
  if (bear) return { score: -8, detail: `空头排列 MA5(${(c5 ?? 0).toFixed(4)}) < MA10 < MA20` }
  // 短期穿越
  if (c5 && c10) {
    if (c5 > c10) return { score: 3, detail: `MA5(${(c5).toFixed(4)}) 在 MA10 上方，短期偏多` }
    if (c5 < c10) return { score: -3, detail: `MA5(${(c5).toFixed(4)}) 在 MA10 下方，短期偏空` }
  }
  return { score: 0, detail: 'MA 交叉不明确，方向中性' }
}

/** MACD 信号 */
function scoreMACD(technicals: TechnicalIndicators, latestIdx: number): { score: number; detail: string } {
  const { macd, signal } = technicals.macd
  if (latestIdx < 2) return { score: 0, detail: 'MACD 数据不足' }

  const m = macd[latestIdx]
  const s = signal[latestIdx]
  const pm = macd[latestIdx - 1]  // 前一个 MACD
  const ps = signal[latestIdx - 1] // 前一个信号线

  if (m === null || s === null || pm === null || ps === null) {
    return { score: 0, detail: 'MACD 计算中' }
  }

  // 金叉：MACD 上穿信号线
  if (pm < ps && m > s) {
    return { score: 8, detail: `MACD 金叉 (${m.toFixed(4)} 上穿 ${s.toFixed(4)})，看涨信号` }
  }
  // 死叉：MACD 下穿信号线
  if (pm > ps && m < s) {
    return { score: -8, detail: `MACD 死叉 (${m.toFixed(4)} 下穿 ${s.toFixed(4)})，看跌信号` }
  }
  // MACD 在信号线上方
  if (m > s) return { score: 3, detail: `MACD(${m.toFixed(4)}) 在信号线上方，偏多` }
  return { score: -3, detail: `MACD(${m.toFixed(4)}) 在信号线下方，偏空` }
}

/** RSI 超买超卖信号 */
function scoreRSI(technicals: TechnicalIndicators, latestIdx: number): { score: number; detail: string } {
  const rsi = technicals.rsi.rsi14[latestIdx]
  if (rsi === null) return { score: 0, detail: 'RSI 数据不足' }

  if (rsi > 80) return { score: -6, detail: `RSI(${rsi.toFixed(1)}) > 80 严重超买，警惕回调` }
  if (rsi > 70) return { score: -4, detail: `RSI(${rsi.toFixed(1)}) > 70 超买区，可能回调` }
  if (rsi < 20) return { score: 6, detail: `RSI(${rsi.toFixed(1)}) < 20 严重超卖，反弹概率大` }
  if (rsi < 30) return { score: 4, detail: `RSI(${rsi.toFixed(1)}) < 30 超卖区，可能反弹` }
  if (rsi > 60) return { score: 2, detail: `RSI(${rsi.toFixed(1)}) 偏强` }
  if (rsi < 40) return { score: -2, detail: `RSI(${rsi.toFixed(1)}) 偏弱` }
  return { score: 0, detail: `RSI(${rsi.toFixed(1)}) 中性区间` }
}

/** Bollinger 位置信号 */
function scoreBollinger(technicals: TechnicalIndicators, latestIdx: number): { score: number; detail: string } {
  const { upper, middle, lower } = technicals.bollinger
  const u = upper[latestIdx]
  const m = middle[latestIdx]
  const l = lower[latestIdx]
  if (u === null || m === null || l === null) return { score: 0, detail: '布林带数据不足' }

  const spread = u - l
  if (spread === 0) return { score: 0, detail: '布林带平坦' }

  // 位置百分比: 0 = 下轨, 100 = 上轨
  const position = ((m - l) !== 0) ? ((m - l) / (spread / 2)) * 50 : 50
  // 带宽判断（收缩 = 变盘前兆）
  const bandWidth = spread / m

  if (position > 90) return { score: -5, detail: `价格接近上轨(${u.toFixed(4)})，超买压力区` }
  if (position < 10) return { score: 5, detail: `价格接近下轨(${l.toFixed(4)})，超卖支撑区` }

  if (bandWidth < 0.02) return { score: 3, detail: `布林带收窄(带宽${(bandWidth * 100).toFixed(1)}%)，变盘前兆` }
  return { score: 1, detail: `布林带中轨附近，位置中性` }
}

/** K 线形态信号（取最近形态的综合方向） */
function scoreKlinePatterns(patterns: DetectedPattern[], latestIdx: number): { score: number; detail: string } {
  // 只取最近 5 根 K 线范围内的形态
  const recent = patterns.filter((p) => latestIdx - p.index <= 5 && latestIdx - p.index >= 0)
  if (recent.length === 0) return { score: 0, detail: '近期未检测到显著形态' }

  let bullishScore = 0
  let bearishScore = 0
  const names: string[] = []
  for (const p of recent) {
    if (p.direction === 'bullish') bullishScore += p.confidence * 10
    else if (p.direction === 'bearish') bearishScore += p.confidence * 10
    names.push(p.description)
  }

  const net = bullishScore - bearishScore
  const detail = names.length > 0
    ? `检测到 ${names.length} 个形态: ${names.join('、')}`
    : '近期无显著形态'

  // 限制在 -8~+8 范围内
  const clamped = Math.max(-8, Math.min(8, Math.round(net)))
  return { score: clamped, detail }
}

/** 成交量均线信号 */
function scoreVolume(technicals: TechnicalIndicators, latestIdx: number): { score: number; detail: string } {
  const { volMa5, volMa20 } = technicals.volMa
  const v5 = volMa5[latestIdx]
  const v20 = volMa20[latestIdx]
  if (v5 === null || v20 === null || v20 === 0) return { score: 0, detail: '成交量数据不足' }

  const ratio = v5 / v20
  if (ratio > 2) return { score: 5, detail: `成交量激增(MA5/M20=${ratio.toFixed(2)})，资金异动` }
  if (ratio > 1.5) return { score: 3, detail: `成交量放大(MA5/M20=${ratio.toFixed(2)})，关注` }
  if (ratio < 0.5) return { score: -2, detail: `成交量萎缩(MA5/M20=${ratio.toFixed(2)})，交投清淡` }
  return { score: 1, detail: `成交量正常(MA5/M20=${ratio.toFixed(2)})` }
}

// ─── 主入口 ───────────────────────────────────────

/**
 * 综合信号评分
 *
 * @param data K 线数据
 * @param patterns 已检测的 K 线形态（可选，内部可自动检测）
 * @param weights 权重配置（可选，默认使用 DEFAULT_WEIGHTS）
 * @returns SignalResult
 */
export function evaluateSignal(
  data: KLineData[],
  patterns?: DetectedPattern[],
  weights: SignalWeights = DEFAULT_WEIGHTS,
): SignalResult {
  const technicals = calculateAll(data)
  const detectedPatterns = patterns ?? detectPatterns(data)
  const latestIdx = data.length - 1

  // 计算各子信号
  const rawSignals: { key: keyof SignalWeights; score: number; detail: string }[] = [
    { key: 'maTrend', ...scoreMATrend(technicals, latestIdx) },
    { key: 'macdCross', ...scoreMACD(technicals, latestIdx) },
    { key: 'rsi', ...scoreRSI(technicals, latestIdx) },
    { key: 'bollinger', ...scoreBollinger(technicals, latestIdx) },
    { key: 'klinePattern', ...scoreKlinePatterns(detectedPatterns, latestIdx) },
    { key: 'volume', ...scoreVolume(technicals, latestIdx) },
  ]

  // 计算加权综合得分
  let totalWeighted = 0
  let totalWeight = 0
  const contributions: SignalContribution[] = []

  for (const sig of rawSignals) {
    const w = weights[sig.key]
    const weightedScore = sig.score * (w / 10) // 权重转换为倍率
    totalWeighted += weightedScore
    totalWeight += w
    contributions.push({
      key: sig.key,
      label: WEIGHT_LABELS[sig.key],
      weight: w,
      score: sig.score,
      detail: sig.detail,
    })
  }

  // 归一化到 -100~+100
  const maxPossible = 10 * (totalWeight / 10) // 满分
  const totalScore = Math.round((totalWeighted / maxPossible) * 100)
  const clamped = Math.max(-100, Math.min(100, totalScore))

  // 方向判断
  let direction: SignalResult['direction']
  let directionLabel: string
  if (clamped >= 60) { direction = 'strong_bullish'; directionLabel = '强烈看多 ↑↑' }
  else if (clamped >= 20) { direction = 'bullish'; directionLabel = '偏多 ↑' }
  else if (clamped > -20) { direction = 'neutral'; directionLabel = '震荡/观望 ↔' }
  else if (clamped > -60) { direction = 'bearish'; directionLabel = '偏空 ↓' }
  else { direction = 'strong_bearish'; directionLabel = '强烈看空 ↓↓' }

  // 置信度：基于有效信号数量
  const validSignals = contributions.filter((c) => c.score !== 0).length
  const confidence = Math.min(1, validSignals / 4) // 至少 4 个信号有值才算高置信度

  return {
    totalScore: clamped,
    direction,
    directionLabel,
    contributions,
    confidence,
  }
}
