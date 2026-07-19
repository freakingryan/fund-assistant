/**
 * 评分快照采集与回填服务
 *
 * 复用「基金详情页」同一套决策管线：
 *   取 K 线 → 检测形态 → 综合评分 → 技术指标 → 命名策略 → buildDecision
 * 把每日收盘评分写入 IndexedDB（scoreSnapshots），并在次日回填实际涨跌，
 * 用于验证决策引擎的真实准确率。
 *
 * 采集门禁：自动采集仅在工作日收盘后（本地 > 15:00）触发；手动采集随时可用。
 * 数据来源：有场内 ETF 映射的基金走腾讯真实 K 线（用户网络可达）；
 *          纯净值基金走东财（当前被网络硬阻断，需部署 Cloudflare Worker 后才可取数）。
 *
 * @module backtest/decisionSnapshot
 */

import { dataSourceService } from '@/adapters/datasource/service'
import { detectPatterns } from '@/services/klinePatterns'
import { evaluateSignal } from '@/services/signalEngine'
import { computeStockSdkIndicators } from '@/services/stockSdkIndicators'
import { evaluateStrategies } from '@/services/strategyLayer'
import { buildDecision } from '@/services/decision/decisionEngine'
import { db } from '@/stores/db'
import type { EtfMapping, FundHolding, KLineData } from '@/types'
import type { Outcome, Recommendation, ScoreSnapshot, ValueSource } from './types'

/** 采集/回填所用 K 线周期：3 个月，足够指标（BIAS 等）计算 */
const SNAPSHOT_PERIOD = '3m'

/** 本地日历日 YYYY-MM-DD（避免 toISOString 的 UTC 偏移） */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 市场是否已收盘（仅工作日且本地时间 ≥ 15:00 视为收盘后可采集）。
 * 周末返回 false（无交易，无需自动采集）。
 */
export function isMarketClosed(now: Date = new Date()): boolean {
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= 15 * 60
}

/** 由评级归一化为回测建议口径 */
function recommendationFromRating(rating: string): Recommendation {
  if (rating === 'strong_buy' || rating === 'buy') return 'buy'
  if (rating === 'hold') return 'hold'
  return 'sell' // reduce / sell / strong_sell
}

/** 由建议 + 次日涨跌幅计算回测结果 */
export function computeOutcome(rec: Recommendation, pct: number): Outcome {
  if (rec === 'hold') return 'neutral'
  if (pct === 0) return 'neutral'
  if (rec === 'buy') return pct > 0 ? 'correct' : 'wrong'
  return pct < 0 ? 'correct' : 'wrong' // sell
}

/**
 * 为单只基金采集一次评分快照（复用详情页决策管线）。
 * 返回写入的快照；若无法取得 K 线（如纯净值基金且东财阻断）返回 null。
 */
export async function captureSnapshotForFund(
  fund: FundHolding,
  etfMappings: EtfMapping[],
): Promise<ScoreSnapshot | null> {
  const etfCode = etfMappings.find((mapping) => mapping.otcCode === fund.code)?.exchangeCode || null

  let klines: KLineData[] = []
  let valueSource: ValueSource = 'unknown'
  if (etfCode) {
    klines = await dataSourceService.fetchEtfKLine(etfCode, SNAPSHOT_PERIOD)
    if (klines.length > 0) valueSource = 'etf'
  }
  if (klines.length === 0) {
    klines = await dataSourceService.fetchKLine(fund.code, SNAPSHOT_PERIOD)
    if (klines.length > 0) valueSource = 'nav'
  }
  if (klines.length === 0) return null

  const patterns = detectPatterns(klines)
  const signalResult = evaluateSignal(klines, patterns)
  const ind = computeStockSdkIndicators(klines)
  const strategies = evaluateStrategies(klines, ind)
  const isRealKline = valueSource === 'etf'
  const decision = buildDecision({ klines, patterns, signalResult, ind, strategies, lowConfidence: !isRealKline })

  const last = klines[klines.length - 1]
  const closeValue = typeof last?.close === 'number' ? last.close : null
  const asOfDate = last?.date || localDateKey()
  const date = localDateKey()
  const id = `${fund.code}-${date}`

  const snapshot: ScoreSnapshot = {
    id,
    fundCode: fund.code,
    fundName: fund.name || fund.code,
    date,
    asOfDate,
    etfCode,
    score: decision.score,
    rating: decision.rating,
    ratingLabel: decision.ratingLabel,
    recommendation: recommendationFromRating(decision.rating),
    bullPower: decision.bullPower,
    bearPower: decision.bearPower,
    bullRatio: decision.bullRatio,
    agreement: decision.agreement,
    conflict: decision.conflict,
    lowConfidence: decision.lowConfidence,
    bullReasons: decision.bullReasons,
    bearReasons: decision.bearReasons,
    strategiesHit: decision.strategies.map((s) => ({ id: s.id, name: s.name, direction: s.direction })),
    summary: decision.summary,
    closeValue,
    valueSource,
    nextDate: null,
    nextValue: null,
    nextChangePct: null,
    outcome: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await db.scoreSnapshots.put(snapshot)
  return snapshot
}

/**
 * 为全部持仓补采当日评分快照（跳过已有记录）。
 * @param force 为 true 时忽略收盘门禁（手动触发）
 * @returns 本次新建的快照数量
 */
export async function captureDailySnapshots(force = false): Promise<number> {
  const now = new Date()
  if (!force && !isMarketClosed(now)) return 0

  const [holdings, settingsList] = await Promise.all([
    db.holdings.toArray(),
    db.settings.toArray(),
  ])
  const etfMappings = settingsList[0]?.etfMappings || []
  const date = localDateKey(now)

  let created = 0
  for (const fund of holdings) {
    const id = `${fund.code}-${date}`
    // 幂等：已有当日快照则跳过
    const existing = await db.scoreSnapshots.get(id)
    if (existing) continue
    try {
      const snap = await captureSnapshotForFund(fund, etfMappings)
      if (snap) created++
    } catch (e) {
      console.warn('[backtest] 快照采集失败', fund.code, e)
    }
  }
  return created
}

/**
 * 回填次日实际涨跌并计算 outcome（幂等）。
 * 对有收盘值、且 outcome 仍为 pending/unknown 的快照，拉取下一交易日 K 线计算。
 * @returns 本次更新的快照数量
 */
export async function reconcileSnapshots(): Promise<number> {
  const all = await db.scoreSnapshots.toArray()
  let updated = 0

  for (const snap of all) {
    if (snap.outcome !== 'pending' && snap.outcome !== 'unknown') continue
    if (snap.closeValue == null) continue
    try {
      const klines = snap.etfCode
        ? await dataSourceService.fetchEtfKLine(snap.etfCode, SNAPSHOT_PERIOD)
        : await dataSourceService.fetchKLine(snap.fundCode, SNAPSHOT_PERIOD)
      const later = klines
        .filter((k) => k.date > snap.asOfDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
      if (later.length === 0) continue // 尚未出现下一交易日数据

      const next = later[0]
      const nextChangePct = snap.closeValue
        ? ((next.close - snap.closeValue) / snap.closeValue) * 100
        : 0
      const outcome = computeOutcome(snap.recommendation, nextChangePct)

      await db.scoreSnapshots.update(snap.id, {
        nextDate: next.date,
        nextValue: next.close,
        nextChangePct,
        outcome,
        updatedAt: Date.now(),
      })
      updated++
    } catch (e) {
      console.warn('[backtest] 回填失败', snap.id, e)
    }
  }
  return updated
}

/** 读取全部快照（按日期倒序） */
export async function getAllSnapshots(): Promise<ScoreSnapshot[]> {
  const all = await db.scoreSnapshots.toArray()
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
