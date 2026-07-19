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
import type { EastmoneyDataSourceConfig, EtfMapping, FundHolding, KLineData } from '@/types'
import type { CaptureFailure, CaptureReport, CaptureSource, Outcome, Recommendation, ScoreSnapshot, ValueSource } from './types'
import { analyzeFundCapitalFlow } from '@/services/capitalFlowAnalysis'

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
  eastmoneyConfig: EastmoneyDataSourceConfig,
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

  // 资金面间接分析（东财增强，门控；enabled=false 时返回 null 且不发东财请求）
  const capital = await analyzeFundCapitalFlow(fund, etfMappings, eastmoneyConfig).catch(() => null)

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
    capitalScore: capital?.capitalScore ?? null,
    northboundScore: capital?.northboundScore ?? null,
    capitalBreakdown: capital?.breakdown ?? null,
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

export interface CaptureOptions {
  /** 为 true 时忽略收盘门禁（手动触发随时可用）；默认遵守工作日 15:00 后自动采集 */
  force?: boolean
  /** 为 true 时忽略“当日已存在快照”的缓存跳过，强制重评全部持仓（覆盖旧结果） */
  reevaluate?: boolean
}

/**
 * 为全部持仓补采当日评分快照。
 * 默认与本地缓存联动：当日已存在快照的基金直接跳过，只补缺失项，不重复发请求。
 * 调用方：
 *   - App 自动采集：force=false，遵守收盘门禁
 *   - 排行榜/回测页手动按钮：force=true 随时可触发；reevaluate=true 时强制重评全部
 * @returns 本次新建或覆盖的快照数量
 */
export async function captureDailySnapshots(opts: CaptureOptions | boolean = false): Promise<number> {
  const force = typeof opts === 'boolean' ? opts : opts.force ?? false
  const reevaluate = typeof opts === 'boolean' ? false : opts.reevaluate ?? false

  const now = new Date()
  if (!force && !isMarketClosed(now)) return 0

  const [holdings, settingsList] = await Promise.all([
    db.holdings.toArray(),
    db.settings.toArray(),
  ])
  const etfMappings = settingsList[0]?.etfMappings || []
  const eastmoneyConfig = settingsList[0]?.dataSource?.eastmoney || { enabled: false, mode: 'proxy', proxyUrl: '' }
  const date = localDateKey(now)

  let created = 0
  const failures: CaptureFailure[] = []
  for (const fund of holdings) {
    const id = `${fund.code}-${date}`
    // 缓存联动：已有当日快照则跳过（除非显式 reevaluate）
    const existing = reevaluate ? null : await db.scoreSnapshots.get(id)
    if (existing) continue
    // 该基金评分所依赖的主数据源：有 ETF 映射走腾讯真实 K 线，否则走东财净值历史
    const etfCode = etfMappings.find((m) => m.otcCode === fund.code)?.exchangeCode || null
    const source: CaptureSource = etfCode ? 'tencent' : 'eastmoney'
    const reason =
      source === 'tencent'
        ? 'ETF 真实 K 线（腾讯源）获取失败，无法评分'
        : '净值历史（东财）当前不可达，无法评分'
    try {
      const snap = await captureSnapshotForFund(fund, etfMappings, eastmoneyConfig)
      if (snap) created++
      else failures.push({ code: fund.code, name: fund.name || fund.code, source, reason })
    } catch (e) {
      console.warn('[backtest] 快照采集失败', fund.code, e)
      failures.push({ code: fund.code, name: fund.name || fund.code, source, reason })
    }
  }
  // 落库本次采集报告，供排行榜标注"因数据源不可达而缺评分"的基金
  await db.captureReports.put({
    id: date,
    date,
    total: holdings.length,
    ok: created,
    failures,
    createdAt: Date.now(),
  })
  return created
}

/** 读取最近一次采集报告（按日期倒序），用于排行榜标注未纳入评分的原因 */
export async function getLatestCaptureReport(): Promise<CaptureReport | null> {
  const all = await db.captureReports.orderBy('date').reverse().toArray()
  return all[0] ?? null
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
