/**
 * 技术指标计算 — 纯前端实现
 *
 * 所有指标均为标准化数学公式，无需依赖外部数据源。
 * AKShare 的 fund_etf_hist_em 返回的是前复权数据，
 * 基于此计算的均线/布林带与主流交易软件一致。
 *
 * @module technicalIndicators
 */

import type { KLineData } from '@/types'

// ─── 类型定义 ─────────────────────────────────────────────

export interface MAValues {
  ma5: (number | null)[]
  ma10: (number | null)[]
  ma20: (number | null)[]
  ma60: (number | null)[]
}

export interface BollingerValues {
  upper: (number | null)[]
  middle: (number | null)[]
  lower: (number | null)[]
}

export interface TechnicalIndicators {
  ma: MAValues
  bollinger: BollingerValues
}

// ─── 工具函数 ─────────────────────────────────────────────

/** 计算简单移动平均线 (SMA) */
function simpleMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null) // 数据不足，返回 null
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += prices[i - j]
      }
      result.push(sum / period)
    }
  }
  return result
}

/** 计算样本标准差 */
function stdDev(prices: number[], period: number, mean: number, endIdx: number): number {
  let sumSq = 0
  for (let j = 0; j < period; j++) {
    const diff = prices[endIdx - j] - mean
    sumSq += diff * diff
  }
  return Math.sqrt(sumSq / period)
}

// ─── 公开 API ─────────────────────────────────────────────

/**
 * 计算 MA5 / MA10 / MA20 / MA60 均线
 *
 * 前 period-1 个值为 null（数据不足）
 * 第 N 个值为：最近 N 根收盘价的算术平均
 *
 * 使用示例：
 * ```ts
 * const ma = calculateMA(data)
 * // ma.ma5[5]  = 第 6 根 K 线的 MA5
 * // ma.ma60[59] = 第 60 根 K 线的 MA60
 * ```
 */
export function calculateMA(data: KLineData[]): MAValues {
  const closes = data.map((d) => d.close)
  return {
    ma5: simpleMA(closes, 5),
    ma10: simpleMA(closes, 10),
    ma20: simpleMA(closes, 20),
    ma60: simpleMA(closes, 60),
  }
}

/**
 * 计算布林带 (Bollinger Bands)
 *
 * 中轨 = MA(period)
 * 上轨 = 中轨 + k × σ
 * 下轨 = 中轨 - k × σ
 *
 * 默认: period=20, k=2
 */
export function calculateBollinger(
  data: KLineData[],
  period = 20,
  k = 2,
): BollingerValues {
  const closes = data.map((d) => d.close)
  const upper: (number | null)[] = []
  const middle: (number | null)[] = []
  const lower: (number | null)[] = []

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null)
      middle.push(null)
      lower.push(null)
    } else {
      // 计算中轨 (MA)
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += closes[i - j]
      }
      const ma = sum / period

      // 计算标准差
      const sigma = stdDev(closes, period, ma, i)

      middle.push(ma)
      upper.push(ma + k * sigma)
      lower.push(ma - k * sigma)
    }
  }

  return { upper, middle, lower }
}

/**
 * 计算全部技术指标
 */
export function calculateAll(data: KLineData[]): TechnicalIndicators {
  return {
    ma: calculateMA(data),
    bollinger: calculateBollinger(data),
  }
}

/**
 * 验证用：对一组已知收盘价手动计算 MA 并返回，
 * 可用于与东方财富等软件对比验证。
 */
export function debugMA(closes: number[], period: number): (number | null)[] {
  return simpleMA(closes, period)
}

/**
 * 验证用：对一组已知值手动计算布林带
 */
export function debugBollinger(
  closes: number[],
  period = 20,
  k = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = []
  const middle: (number | null)[] = []
  const lower: (number | null)[] = []

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null)
      middle.push(null)
      lower.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += closes[i - j]
      }
      const ma = sum / period
      const sigma = stdDev(closes, period, ma, i)
      middle.push(ma)
      upper.push(ma + k * sigma)
      lower.push(ma - k * sigma)
    }
  }

  return { upper, middle, lower }
}
