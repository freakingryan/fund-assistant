/**
 * stock-sdk 技术指标 + 事件信号封装（纯本地计算，零网络）
 *
 * 项目已有 signalEngine（MA/MACD/RSI/BOLL 加权评分）与 klinePatterns（K 线形态），
 * 本模块补足项目**缺失**的指标：KDJ / WR / CCI / BIAS / ATR / OBV / DMI / SAR / KC / ROC，
 * 以及 stock-sdk/signals 的事件信号（金叉/死叉、超买超卖、布林突破、SAR 反转）。
 *
 * 所有计算走 stock-sdk 的 /indicators 与 /signals 子路径（纯函数，tree-shake 友好），
 * 不触发任何东方财富网络请求 —— 因此在用户网络屏蔽东财时依然可用。
 *
 * 净值走势（NAV）模式只有 close、无真实 OHLC 区间，KDJ/WR/CCI/ATR/OBV/DMI/SAR/KC
 * 退化为无意义值，故 NAV 模式下仅计算 close 类指标（BIAS / ROC）并提示切换 ETF K 线。
 *
 * @module stockSdkIndicators
 */

import type { KLineData } from '@/types'
import {
  addIndicators,
  type AnyHistoryKline,
  type IndicatorOptions,
  type KlineWithIndicators,
} from 'stock-sdk/indicators'
import { calcSignals, type Signal, type SignalType } from 'stock-sdk/signals'

// ─── 输入映射 ─────────────────────────────────────

/** KLineData.date (YYYY-MM-DD, A 股) → 北京时间 00:00 的 UTC 毫秒（calcSignals 需要非 null） */
function parseDateToTs(date: string): number {
  const t = Date.parse(`${date}T00:00:00+08:00`)
  return Number.isNaN(t) ? 0 : t
}

/** 项目 KLineData → stock-sdk HistoryKline（A 股时区，可缺字段置 null） */
function toSdkKline(k: KLineData): AnyHistoryKline {
  return {
    date: k.date,
    timestamp: parseDateToTs(k.date),
    tz: 'Asia/Shanghai',
    code: '',
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    amount: null,
    amplitude: null,
    changePercent: null,
    change: null,
    turnoverRate: null,
  }
}

// ─── 输出类型 ─────────────────────────────────────

export interface IndicatorSnapshot {
  kdj?: { k: number | null; d: number | null; j: number | null }
  wr?: Record<string, number | null>
  cci?: number | null
  bias?: Record<string, number | null>
  atr?: { tr: number | null; atr: number | null }
  dmi?: { pdi: number | null; mdi: number | null; adx: number | null; adxr: number | null }
  sar?: { sar: number | null; trend: 1 | -1 | null }
  kc?: { mid: number | null; upper: number | null; lower: number | null; width: number | null }
  roc?: { roc: number | null; signal: number | null }
}

export type SignalDirection = 'up' | 'down' | 'neutral'

export interface SignalEvent {
  type: SignalType
  label: string
  date: string
  direction: SignalDirection
  detail?: Record<string, number>
}

export interface StockSdkIndicatorsResult {
  /** 是否存在真实 OHLC 区间（ETF 真实 K 线 = true；净值走势 = false） */
  ohlcAvailable: boolean
  /** 各指标最新非空值快照 */
  latest: IndicatorSnapshot
  /** 最近的技术事件信号（按日期倒序） */
  signals: SignalEvent[]
}

// ─── 计算选项 ─────────────────────────────────────

const NAV_INDICATORS: IndicatorOptions = {
  bias: true,
  roc: true,
}

const FULL_INDICATORS: IndicatorOptions = {
  ma: true,
  macd: true,
  boll: true,
  rsi: true,
  kdj: true,
  wr: true,
  bias: true,
  cci: true,
  atr: true,
  obv: true,
  roc: true,
  dmi: true,
  sar: true,
  kc: true,
}

const SIGNAL_OPTIONS = {
  ma: { fast: 5, slow: 20 },
  macd: true,
  kdj: { overbought: 80, oversold: 20 },
  rsi: { period: 6, overbought: 70, oversold: 30 },
  boll: true,
  sar: true,
}

const SIGNAL_LABELS: Record<SignalType, { label: string; direction: SignalDirection }> = {
  ma_golden_cross: { label: 'MA 金叉', direction: 'up' },
  ma_death_cross: { label: 'MA 死叉', direction: 'down' },
  macd_golden_cross: { label: 'MACD 金叉', direction: 'up' },
  macd_death_cross: { label: 'MACD 死叉', direction: 'down' },
  kdj_golden_cross: { label: 'KDJ 金叉', direction: 'up' },
  kdj_death_cross: { label: 'KDJ 死叉', direction: 'down' },
  kdj_overbought: { label: 'KDJ 超买', direction: 'down' },
  kdj_oversold: { label: 'KDJ 超卖', direction: 'up' },
  rsi_overbought: { label: 'RSI 超买', direction: 'down' },
  rsi_oversold: { label: 'RSI 超卖', direction: 'up' },
  boll_break_upper: { label: '布林上轨突破', direction: 'up' },
  boll_break_lower: { label: '布林下轨突破', direction: 'down' },
  sar_reversal_up: { label: 'SAR 反转向上', direction: 'up' },
  sar_reversal_down: { label: 'SAR 反转向下', direction: 'down' },
}

const MIN_BARS = 10

// ─── 主入口 ───────────────────────────────────────

/**
 * 计算 stock-sdk 技术指标与事件信号。
 * @param klines 项目 KLineData[]（按日期升序）
 * @param maxSignals 返回最近多少条信号事件，默认 12
 */
export function computeStockSdkIndicators(
  klines: KLineData[],
  maxSignals = 12,
): StockSdkIndicatorsResult {
  const empty: StockSdkIndicatorsResult = { ohlcAvailable: false, latest: {}, signals: [] }
  if (!klines || klines.length < MIN_BARS) return empty

  const ohlcAvailable = klines.some((k) => k.high > k.low)
  const sdkKlines = klines.map(toSdkKline)

  const withInds = addIndicators(sdkKlines, ohlcAvailable ? FULL_INDICATORS : NAV_INDICATORS)
  const latest = extractLatest(withInds, ohlcAvailable)

  let signals: SignalEvent[] = []
  if (ohlcAvailable) {
    signals = toSignalEvents(calcSignals(withInds, SIGNAL_OPTIONS), klines)
      .slice(-maxSignals)
      .reverse()
  }

  return { ohlcAvailable, latest, signals }
}

// ─── 内部工具 ─────────────────────────────────────

function extractLatest(klines: KlineWithIndicators<AnyHistoryKline>[], ohlcAvailable: boolean): IndicatorSnapshot {
  const last = klines[klines.length - 1]
  const snap: IndicatorSnapshot = {}
  if (last.bias) snap.bias = last.bias
  if (last.roc) snap.roc = last.roc
  if (!ohlcAvailable) return snap
  if (last.kdj) snap.kdj = last.kdj
  if (last.wr) snap.wr = last.wr
  if (last.cci) snap.cci = last.cci.cci
  if (last.atr) snap.atr = last.atr
  if (last.dmi) snap.dmi = last.dmi
  if (last.sar) snap.sar = { sar: last.sar.sar, trend: last.sar.trend }
  if (last.kc) snap.kc = last.kc
  return snap
}

function toSignalEvents(signals: Signal[], klines: KLineData[]): SignalEvent[] {
  return signals
    .filter((s) => s.index >= 0 && s.index < klines.length)
    .map((s) => {
      const meta = SIGNAL_LABELS[s.type]
      return {
        type: s.type,
        label: meta.label,
        date: klines[s.index].date,
        direction: meta.direction,
        detail: s.detail,
      }
    })
}
