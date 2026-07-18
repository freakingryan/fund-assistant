/**
 * 本地策略层 — 命名策略（移植自 daily_stock_analysis 的算法决策思路，纯前端、零网络）
 *
 * 借鉴 DSA 的 strategies/*.yaml 概念（多头趋势 / 均线金叉 / 缩量回踩 / 量能突破 /
 * 超卖反弹 / 箱体），用项目已有的 technicalIndicators 计算 MA/量能/RSI，结合
 * stockSdkIndicators 的 KDJ/CCI，产出命名策略命中（方向 + 置信度 + 说明）。
 *
 * 这些策略与指标/形态/评分**正交**：它们从"战术场景"角度给出信号，是决策引擎的第
 * 四个信号来源。全部为纯本地计算，不受东方财富网络阻断影响。
 *
 * @module strategyLayer
 */

import { calculateAll } from './technicalIndicators'
import type { KLineData } from '@/types'
import type { StockSdkIndicatorsResult } from './stockSdkIndicators'
import type { Direction, SignalCategory } from './decision/types'

/** 命中的命名策略 */
export interface StrategyHit {
  id: string
  name: string
  direction: Direction
  confidence: number // 0~1
  detail: string
  category: SignalCategory
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 评估全部本地策略。
 * @param klines 项目 KLineData[]（升序）
 * @param ind stockSdkIndicators 计算结果（提供 KDJ/CCI/SAR 等）
 */
export function evaluateStrategies(
  klines: KLineData[],
  ind?: StockSdkIndicatorsResult,
): StrategyHit[] {
  const hits: StrategyHit[] = []
  if (!klines || klines.length < 5) return hits

  const tech = calculateAll(klines)
  const last = klines.length - 1
  const { ma5, ma10, ma20 } = tech.ma
  const close = klines[last].close

  const v5 = tech.volMa.volMa5[last]
  const v20 = tech.volMa.volMa20[last]

  // ── 1. 多头趋势 ──
  const c5 = ma5[last]
  const c10 = ma10[last]
  const c20 = ma20[last]
  if (c5 !== null && c10 !== null && c20 !== null) {
    if (c5 > c10 && c10 > c20 && close > c20) {
      hits.push({
        id: 'bull_trend',
        name: '多头趋势',
        direction: 'bull',
        confidence: 0.85,
        detail: `均线多头排列 MA5>MA10>MA20，价格站上全部均线`,
        category: 'trend',
      })
    } else if (c5 < c10 && c10 < c20 && close < c20) {
      hits.push({
        id: 'bear_trend',
        name: '空头趋势',
        direction: 'bear',
        confidence: 0.85,
        detail: `均线空头排列 MA5<MA10<MA20，价格承压于均线下方`,
        category: 'trend',
      })
    }
  }

  // ── 2. 均线金叉 / 死叉（MA5 上穿 MA10） ──
  if (last >= 1 && ma5[last] !== null && ma10[last] !== null && ma5[last - 1] !== null && ma10[last - 1] !== null) {
    const crossUp = ma5[last - 1]! <= ma10[last - 1]! && ma5[last]! > ma10[last]!
    const crossDown = ma5[last - 1]! >= ma10[last - 1]! && ma5[last]! < ma10[last]!
    if (crossUp) {
      hits.push({
        id: 'ma_golden_cross',
        name: '均线金叉',
        direction: 'bull',
        confidence: 0.7,
        detail: 'MA5 上穿 MA10，短期趋势转强',
        category: 'trend',
      })
    } else if (crossDown) {
      hits.push({
        id: 'ma_death_cross',
        name: '均线死叉',
        direction: 'bear',
        confidence: 0.7,
        detail: 'MA5 下穿 MA10，短期趋势转弱',
        category: 'trend',
      })
    }
  }

  // ── 3. 缩量回踩（健康回调） ──
  if (c20 !== null && v5 !== null && v20 !== null && v20 > 0) {
    const volRatio = v5 / v20
    const pullback = klines[last].close < klines[last - 1]?.close
    if (pullback && volRatio < 0.7 && close > c20) {
      hits.push({
        id: 'pullback_low_volume',
        name: '缩量回踩',
        direction: 'bull',
        confidence: 0.6,
        detail: `回调中成交量萎缩(MA5/MA20=${volRatio.toFixed(2)})，仍守住 MA20，属健康回踩`,
        category: 'volume',
      })
    }
  }

  // ── 4. 量能突破 ──
  if (v5 !== null && v20 !== null && v20 > 0 && c5 !== null) {
    const volRatio = v5 / v20
    if (volRatio > 1.8 && close >= c5) {
      hits.push({
        id: 'volume_breakout',
        name: '量能突破',
        direction: 'bull',
        confidence: 0.6,
        detail: `成交量骤增(MA5/MA20=${volRatio.toFixed(2)})，价格站上 MA5，资金主动介入`,
        category: 'volume',
      })
    }
  }

  // ── 5. 超卖反弹 ──
  const rsi = tech.rsi.rsi14[last]
  const kdj = ind?.latest.kdj
  const cci = ind?.latest.cci
  const oversold =
    (rsi !== null && rsi < 30) ||
    (kdj?.k !== null && kdj?.k !== undefined && kdj.k < 20) ||
    (cci !== null && cci !== undefined && cci < -100)
  if (oversold) {
    const parts: string[] = []
    if (rsi !== null && rsi < 30) parts.push(`RSI(${rsi.toFixed(1)})`)
    if (kdj?.k !== null && kdj?.k !== undefined && kdj.k < 20) parts.push(`KDJ.K(${kdj.k.toFixed(1)})`)
    if (cci !== null && cci !== undefined && cci < -100) parts.push(`CCI(${cci.toFixed(1)})`)
    hits.push({
      id: 'oversold_rebound',
      name: '超卖反弹',
      direction: 'bull',
      confidence: 0.6,
      detail: `进入超卖区(${parts.join('/')})，存在技术反弹需求`,
      category: 'momentum',
    })
  }

  // ── 6. 箱体震荡（波段，中性） ──
  if (klines.length >= 20) {
    const window = klines.slice(-20)
    const highs = window.map((k) => k.high)
    const lows = window.map((k) => k.low)
    const max = Math.max(...highs)
    const min = Math.min(...lows)
    const mid = (max + min) / 2
    const band = mid > 0 ? (max - min) / mid : 0
    if (band < 0.08) {
      hits.push({
        id: 'box_range',
        name: '箱体震荡',
        direction: 'neutral',
        confidence: 0.5,
        detail: `近 20 日振幅仅 ${(band * 100).toFixed(1)}%，处于区间整理，宜高抛低吸`,
        category: 'pattern',
      })
    }
  }

  return hits.map((h) => ({ ...h, confidence: clamp(h.confidence, 0, 1) }))
}
