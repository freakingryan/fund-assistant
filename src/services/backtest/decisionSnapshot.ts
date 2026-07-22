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
 *          纯净值基金走东财净值历史（用户网络已实测可达，无需 Worker）。
 *          资金面 / 板块赛道等增强维度走东财，受「东财资金面增强」开关门控。
 *
 * @module backtest/decisionSnapshot
 */

import { dataSourceService } from '@/adapters/datasource/service'
import { detectPatterns } from '@/services/klinePatterns'
import { evaluateSignal } from '@/services/signalEngine'
import { computeStockSdkIndicators } from '@/services/stockSdkIndicators'
import type { SignalEvent } from '@/services/stockSdkIndicators'
import { evaluateStrategies } from '@/services/strategyLayer'
import { buildDecision } from '@/services/decision/decisionEngine'
import type { Rating, ReasonItem } from '@/services/decision/types'
import { db } from '@/stores/db'
import type { EastmoneyDataSourceConfig, EtfMapping, FundHolding, KLineData } from '@/types'
import type { CaptureFailure, CaptureReport, CaptureSource, Outcome, Recommendation, ScoreSnapshot, ValueSource } from './types'
import { analyzeFundCapitalFlow } from '@/services/capitalFlowAnalysis'
import { analyzeFundSectorStrength } from '@/services/sectorStrengthAnalysis'
import { fetchFundRankHistory } from '@/services/fundRankHistory'
import { isTradingDay } from '@/lib/tradingCalendar'

/** 采集/回填所用 K 线周期：3 个月，足够指标（BIAS 等）计算 */
const SNAPSHOT_PERIOD = '3m'

/**
 * 单日涨跌幅合理上限(%)。A 股 ±10%，QDII/部分品种一般 <±20%。
 * 超过此值视为数据源单位换算等异常（如 -67%），不计入方向性命中，避免污染准确率。
 */
const MAX_DAILY_CHANGE_PCT = 30

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

/** 基金净值类快照判定为“数据已公布”的本地小时（净值多在 20:00 后定稿） */
const FUND_NAV_READY_HOUR = 20

/**
 * 基金数据是否已公布（净值型基金口径）：工作日且本地时间 ≥ 20:00。
 * 此时东财等来源的基金净值大多已定稿；ETF 实时价 15:00 即定，但为统一口径
 * 自动采集也等此时间点，避免盘后早期采到“昨日净值”当今日基准。
 */
export function isFundDataReady(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= FUND_NAV_READY_HOUR * 60
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
  /** 回溯补齐时指定目标交易日；省略则取本地今日 */
  targetDate?: string,
  /** 可选共享 K 线缓存：批量扫描（captureDailySnapshots）传入，避免同一 ETF/基金被重复请求同一接口 */
  klineMemo?: Map<string, KLineData[]>,
): Promise<ScoreSnapshot | null> {
  const etfCode = etfMappings.find((mapping) => mapping.otcCode === fund.code)?.exchangeCode || null

  let klines: KLineData[] = []
  let valueSource: ValueSource = 'unknown'
  if (etfCode) {
    const memoKey = `etf:${etfCode}`
    if (!klineMemo?.has(memoKey)) {
      const fetched = await dataSourceService.fetchEtfKLine(etfCode, SNAPSHOT_PERIOD)
      klineMemo?.set(memoKey, fetched ?? [])
    }
    const fetched = klineMemo?.get(memoKey) ?? []
    if (fetched.length > 0) { klines = fetched; valueSource = 'etf' }
  }
  if (klines.length === 0) {
    const memoKey = `nav:${fund.code}`
    if (!klineMemo?.has(memoKey)) {
      const fetched = await dataSourceService.fetchKLine(fund.code, SNAPSHOT_PERIOD)
      klineMemo?.set(memoKey, fetched ?? [])
    }
    const fetched = klineMemo?.get(memoKey) ?? []
    if (fetched.length > 0) { klines = fetched; valueSource = 'nav' }
  }
  if (klines.length === 0) return null

  // 回溯补齐：截断到目标交易日，避免引入未来 K 线造成前视偏差（look-ahead bias）
  if (targetDate) klines = klines.filter((k) => k.date <= targetDate)
  if (klines.length === 0) return null

  const patterns = detectPatterns(klines)
  const signalResult = evaluateSignal(klines, patterns)
  const ind = computeStockSdkIndicators(klines)
  const strategies = evaluateStrategies(klines, ind)
  const isRealKline = valueSource === 'etf'
  const decision = buildDecision({ klines, patterns, signalResult, ind, strategies, lowConfidence: !isRealKline })

  // 资金面间接分析（东财增强，门控；enabled=false 时返回 null 且不发东财请求）
  const capital = await analyzeFundCapitalFlow(fund, etfMappings, eastmoneyConfig).catch(() => null)
  // 板块赛道强度间接分析（同门控）
  const sector = await analyzeFundSectorStrength(fund, etfMappings, eastmoneyConfig).catch(() => null)
  // 同类排名走势（东财增强，同门控；取最新百分位点）
  const rankHist = await fetchFundRankHistory(fund.code, eastmoneyConfig).catch(() => null)

  const last = klines[klines.length - 1]
  const closeValue = typeof last?.close === 'number' ? last.close : null
  const asOfDate = last?.date || (targetDate ?? localDateKey())
  const now = new Date()
  const date = targetDate ?? localDateKey(now)
  const id = `${fund.code}-${date}`
  // 回溯/补全（目标日为过去交易日）→ 数据已定稿，非临时；
  // 今日快照：ETF 盘后(≥15:00)准确，净值基金需净值公布(≥20:00)后才准确，否则标记临时待覆盖。
  const isPast = targetDate != null && targetDate < localDateKey(now)
  const marketReady = isPast || isMarketClosed(now)
  const navReady = isPast || isFundDataReady(now)
  const provisional = etfCode ? !marketReady : !navReady

  const snapshot: ScoreSnapshot = {
    id,
    fundCode: fund.code,
    fundName: fund.name || fund.code,
    date,
    asOfDate,
    etfCode,
    provisional,
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
    sectorScore: sector?.combinedScore ?? null,
    sectorBreakdown: sector?.breakdown ?? null,
    rankPercentile: rankHist?.latest?.percentile ?? null,
    rankValue: rankHist?.latest?.rank ?? null,
    rankTotal: rankHist?.latest?.total ?? null,
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

/** 决策引擎趋势结果（供预警 trend 规则 / 日报复用，不写库） */
export interface FundTrendResult {
  score: number
  lowConfidence: boolean
  rating: Rating
  ratingLabel: string
  summary: string
  /** 最近的技术事件信号（金叉/死叉/SAR 反转/布林突破等） */
  signals: SignalEvent[]
  bullReasons: ReasonItem[]
  bearReasons: ReasonItem[]
}

/**
 * 为单只基金跑完整决策管线并返回趋势结果（不写库）。
 * 复用与 captureSnapshotForFund 完全相同的 K 线获取 + buildDecision 逻辑，
 * 供 `scan()` 的 trend 规则与「每日日报」模块3/4 共用，避免重复实现。
 * 数据来源：有场内 ETF 映射走腾讯真实 K 线；否则走东财净值历史。
 * 无法取得 K 线（如纯净值基金且东财阻断）返回 null。
 */
export async function computeFundTrendScore(
  fund: FundHolding,
  etfMappings: EtfMapping[],
): Promise<FundTrendResult | null> {
  const etfCode = etfMappings.find((mapping) => mapping.otcCode === fund.code)?.exchangeCode || null

  let klines: KLineData[] = []
  if (etfCode) {
    klines = (await dataSourceService.fetchEtfKLine(etfCode, SNAPSHOT_PERIOD)) ?? []
  }
  if (klines.length === 0) {
    klines = (await dataSourceService.fetchKLine(fund.code, SNAPSHOT_PERIOD)) ?? []
  }
  if (klines.length === 0) return null

  const patterns = detectPatterns(klines)
  const signalResult = evaluateSignal(klines, patterns)
  const ind = computeStockSdkIndicators(klines)
  const strategies = evaluateStrategies(klines, ind)
  const isRealKline = klines.some((k) => k.high > k.low)
  const decision = buildDecision({
    klines,
    patterns,
    signalResult,
    ind,
    strategies,
    lowConfidence: !isRealKline,
  })

  return {
    score: decision.score,
    lowConfidence: decision.lowConfidence,
    rating: decision.rating,
    ratingLabel: decision.ratingLabel,
    summary: decision.summary,
    signals: ind.signals,
    bullReasons: decision.bullReasons,
    bearReasons: decision.bearReasons,
  }
}

export interface CaptureOptions {
  /** 为 true 时忽略收盘门禁（手动触发随时可用）；默认遵守工作日 15:00 后自动采集 */
  force?: boolean
  /** 为 true 时忽略“当日已存在快照”的缓存跳过，强制重评全部持仓（覆盖旧结果） */
  reevaluate?: boolean
  /** 回溯补齐指定交易日（YYYY-MM-DD）；省略则采集今日。采集过去交易日不受收盘门禁限制 */
  targetDate?: string
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
  const targetDate = typeof opts === 'boolean' ? undefined : opts.targetDate

  const now = new Date()
  const date = targetDate ?? localDateKey(now)
  // 门禁：采集「今日」需本地收盘后（≥15:00）且为交易日；回溯采集「过去交易日」随时允许（该日已收盘）
  const capturingPast = targetDate != null && targetDate < localDateKey(now)
  if (!force && !capturingPast && (!isMarketClosed(now) || !isTradingDay(now))) return 0

  const [holdings, settingsList] = await Promise.all([
    db.holdings.toArray(),
    db.settings.toArray(),
  ])
  const etfMappings = settingsList[0]?.etfMappings || []
  const eastmoneyConfig = settingsList[0]?.dataSource?.eastmoney || { enabled: false, mode: 'proxy', proxyUrl: '' }

  let created = 0
  // 批量扫描共享 K 线缓存：同一 ETF/基金在本次扫描中只请求一次接口
  const klineMemo = new Map<string, KLineData[]>()
  const failures: CaptureFailure[] = []
  for (const fund of holdings) {
    const id = `${fund.code}-${date}`
    // 缓存联动：已有当日快照按状态处理
    const existing = await db.scoreSnapshots.get(id)
    if (existing) {
      // 已回填（历史验证数据）：永远保护，覆盖会丢失 nextChangePct/outcome，破坏回测基准
      if (existing.nextChangePct != null) continue
      // 东财增强开启后：已存在但缺少增强维度（资金面/赛道/同类排名）的旧快照需要补填，
      // 否则「更新今日评分」会因缓存跳过而永远不补，导致增强排序形同虚设。
      const eastEnabled = eastmoneyConfig.enabled
      const missingEnhanced =
        eastEnabled &&
        existing.capitalScore == null &&
        existing.sectorScore == null &&
        existing.rankPercentile == null
      if (reevaluate) {
        // 强制重评未回填快照（历史验证数据已在上面跳过保护）；其余全覆盖
      } else if (!missingEnhanced && existing.provisional !== true) {
        // 非临时且增强维度齐全的盘后准确快照：读缓存，不再重复采集
        continue
      }
      // 其余情况（盘中临时快照 provisional=true 待盘后覆盖 / 缺增强维度待补）落到下方重新采集
    }
    // 该基金评分所依赖的主数据源：有 ETF 映射走腾讯真实 K 线，否则走东财净值历史
    const etfCode = etfMappings.find((m) => m.otcCode === fund.code)?.exchangeCode || null
    const source: CaptureSource = etfCode ? 'tencent' : 'eastmoney'
    const reason =
      source === 'tencent'
        ? 'ETF 真实 K 线（腾讯源）获取失败，无法评分'
        : '净值历史（东财）当前不可达，无法评分'
    try {
      const snap = await captureSnapshotForFund(fund, etfMappings, eastmoneyConfig, date, klineMemo)
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

/**
 * 回溯补齐最近缺失的交易日快照。
 *
 * 解决「用户仅收盘前打开过一次、当日未采集，且之后当天再没打开」导致该日快照永久缺失的问题：
 * 在后续任意一次打开应用时，对最近 lookbackDays 天内、尚无任何快照的工作日，
 * 用截断至该日的 K 线（避免引入未来数据 / 前视偏差）补采。
 * 天然幂等：已有快照的工作日直接跳过；单只基金也已按 `${code}-${date}` 主键去重。
 *
 * @param lookbackDays 向前回溯的自然日窗口（默认 7）
 * @returns 本次补齐的快照数量
 */
export async function backfillMissingTradingDays(lookbackDays = 7): Promise<number> {
  const now = new Date()
  const today = localDateKey(now)
  let done = 0
  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    if (!isTradingDay(d)) continue // 跳过周末与法定节假日（非交易日）
    const day = localDateKey(d)
    if (day >= today) continue // 不回溯今日（今日由每日首次守卫处理）
    const count = await db.scoreSnapshots.where('date').equals(day).count()
    if (count > 0) continue // 该日已有快照，跳过
    const n = await captureDailySnapshots({ targetDate: day }) // 过去交易日，随时可补
    done += n
  }
  return done
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
  // 批量回填共享 K 线缓存：同一 ETF/基金在本次回填中只请求一次接口
  const klineMemo = new Map<string, KLineData[]>()
  let updated = 0
  let isolated = 0
  let failed = 0

  for (const snap of all) {
    if (snap.closeValue == null) continue
    try {
      const memoKey = snap.etfCode ? `etf:${snap.etfCode}` : `nav:${snap.fundCode}`
      let klines = klineMemo.get(memoKey)
      if (!klineMemo.has(memoKey)) {
        klines = snap.etfCode
          ? await dataSourceService.fetchEtfKLine(snap.etfCode, SNAPSHOT_PERIOD)
          : await dataSourceService.fetchKLine(snap.fundCode, SNAPSHOT_PERIOD)
        // 强制非 null（接口失败兜底空数组），避免后续 .filter 在 null 上崩溃
        klineMemo.set(memoKey, klines ?? [])
      }
      klines = klineMemo.get(memoKey) ?? []
      if (klines.length === 0) continue // 无 K 线（接口失败或尚未上市）则跳过回填
      const later = klines
        .filter((k) => k.date > snap.asOfDate)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
      if (later.length === 0) continue // 尚未出现下一交易日数据

      const next = later[0]
      const nextChangePct = snap.closeValue
        ? ((next.close - snap.closeValue) / snap.closeValue) * 100
        : 0

      // 数据质量守卫：单日涨跌幅超出合理上限（如单位换算错误导致 -67%）视为数据异常，
      // 隔离为 unknown 不计入方向性命中。已结算快照也会在此被自愈（旧逻辑只处理 pending/unknown，脏数据永不修正）。
      if (!Number.isFinite(nextChangePct) || Math.abs(nextChangePct) > MAX_DAILY_CHANGE_PCT) {
        if (snap.outcome !== 'unknown') {
          await db.scoreSnapshots.update(snap.id, {
            nextDate: next.date,
            nextValue: next.close,
            nextChangePct: null,
            outcome: 'unknown',
            updatedAt: Date.now(),
          })
          updated++
          isolated++
        }
        continue
      }

      const outcome = computeOutcome(snap.recommendation, nextChangePct)
      // 幂等自愈：已结算快照若 pct 有效也重算 outcome（与最新数据一致）；pending/unknown 正常回填
      if (snap.outcome !== outcome || snap.nextChangePct == null) {
        await db.scoreSnapshots.update(snap.id, {
          nextDate: next.date,
          nextValue: next.close,
          nextChangePct,
          outcome,
          updatedAt: Date.now(),
        })
        updated++
      }
    } catch {
      failed++
    }
  }
  // 聚合日志：避免逐条打印导致控制台刷屏（自愈成功不应产生噪音）
  if (isolated > 0 || failed > 0) {
    console.warn(
      `[backtest] 回填完成：检查 ${all.length} 条，隔离 ${isolated} 条异常涨跌（|pct|>${MAX_DAILY_CHANGE_PCT}%）已标记为 unknown，${failed} 条拉取失败；共更新 ${updated} 条`,
    )
  }
  return updated
}

/** 读取全部快照（按日期倒序） */
export async function getAllSnapshots(): Promise<ScoreSnapshot[]> {
  const all = await db.scoreSnapshots.toArray()
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
