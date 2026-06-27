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

export interface MACDValues {
  macd: (number | null)[]     // MACD 线 = EMA12 - EMA26
  signal: (number | null)[]   // 信号线 = EMA9(MACD)
  histogram: (number | null)[] // 柱状图 = MACD - Signal
}

export interface RSIValues {
  rsi14: (number | null)[]    // RSI(14)
}

export interface VolumeMAValues {
  volMa5: (number | null)[]
  volMa10: (number | null)[]
  volMa20: (number | null)[]
}

export interface TechnicalIndicators {
  ma: MAValues
  bollinger: BollingerValues
  macd: MACDValues
  rsi: RSIValues
  volMa: VolumeMAValues
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

/** 计算指数移动平均线 (EMA) */
function ema(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const k = 2 / (period + 1)
  let prevEma: number | null = null
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else if (i === period - 1) {
      // 第一个 EMA 用 SMA 初始化
      let sum = 0
      for (let j = 0; j < period; j++) sum += prices[i - j]
      prevEma = sum / period
      result.push(prevEma)
    } else {
      prevEma = (prices[i] - prevEma!) * k + prevEma!
      result.push(prevEma)
    }
  }
  return result
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
 * 计算 MACD (Moving Average Convergence Divergence)
 *
 * MACD 线 = EMA(close, 12) - EMA(close, 26)
 * 信号线 = EMA(MACD, 9)
 * 柱状图 = MACD - 信号线
 *
 * 金叉：MACD 上穿信号线（看涨）
 * 死叉：MACD 下穿信号线（看跌）
 */
export function calculateMACD(data: KLineData[]): MACDValues {
  const closes = data.map((d) => d.close)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const firstValid = Math.max(12, 26) - 1 // 25, 两根EMA都可用

  // 计算 MACD 线
  const macdLine: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < firstValid || ema12[i] === null || ema26[i] === null) {
      macdLine.push(null)
    } else {
      macdLine.push(ema12[i]! - ema26[i]!)
    }
  }

  // 提取有效 MACD 值计算信号线
  const validMacd = macdLine.filter((v) => v !== null) as number[]
  const rawSignal = ema(validMacd, 9)

  // 将信号线映射回原始索引
  const signal: (number | null)[] = []
  let sigIdx = 0
  for (let i = 0; i < closes.length; i++) {
    if (i < firstValid) {
      signal.push(null)
    } else {
      signal.push(rawSignal[sigIdx] ?? null)
      sigIdx++
    }
  }

  // 柱状图
  const histogram: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null || signal[i] === null) {
      histogram.push(null)
    } else {
      histogram.push(macdLine[i]! - signal[i]!)
    }
  }

  return { macd: macdLine, signal, histogram }
}

/**
 * 计算 RSI (Relative Strength Index)
 *
 * RSI = 100 - 100 / (1 + RS)
 * RS = 平均涨幅 / 平均跌幅（取绝对值）
 * 默认周期 14
 *
 * RSI > 70: 超买（可能回调）
 * RSI < 30: 超卖（可能反弹）
 */
export function calculateRSI(data: KLineData[], period = 14): RSIValues {
  const closes = data.map((d) => d.close)
  const rsi14: (number | null)[] = []

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      rsi14.push(null)
    } else {
      let gains = 0
      let losses = 0
      for (let j = 0; j < period; j++) {
        const change = closes[i - j] - closes[i - j - 1]
        if (change > 0) gains += change
        else losses += Math.abs(change)
      }
      const avgGain = gains / period
      const avgLoss = losses / period
      if (avgLoss === 0) {
        rsi14.push(100)
      } else {
        const rs = avgGain / avgLoss
        rsi14.push(100 - 100 / (1 + rs))
      }
    }
  }

  return { rsi14 }
}

/**
 * 计算成交量均线 (VOL-MA)
 *
 * 类似价格均线但计算成交量的移动平均
 * volMa5 / volMa10 / volMa20
 */
export function calculateVolMA(data: KLineData[]): VolumeMAValues {
  const volumes = data.map((d) => d.volume)
  return {
    volMa5: simpleMA(volumes, 5),
    volMa10: simpleMA(volumes, 10),
    volMa20: simpleMA(volumes, 20),
  }
}

/**
 * 计算全部技术指标（含 MA、Bollinger、MACD、RSI、成交量均线）
 */
export function calculateAll(data: KLineData[]): TechnicalIndicators {
  return {
    ma: calculateMA(data),
    bollinger: calculateBollinger(data),
    macd: calculateMACD(data),
    rsi: calculateRSI(data),
    volMa: calculateVolMA(data),
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
