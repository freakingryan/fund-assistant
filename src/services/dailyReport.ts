/**
 * 每日日报聚合服务
 *
 * 把「持仓盈亏 + 行动建议 + 计划进度 + 板块温度/当日信号」四个模块聚合为一份
 * DailyReport，幂等落库（主键 date = YYYY-MM-DD）。
 *
 * 模块依赖：
 *  - 组合盈亏：持仓 + 行情（无外部依赖）
 *  - 行动建议：当日 scan 产出的待处理 alert（db.alerts）
 *  - 计划进度：plan.rules + 组合指标 + 趋势分（决策引擎，复用 computeFundTrendScore）
 *  - 板块温度：analyzeFundSectorStrength（东财增强门控，未开启则显示不可用）
 *  - 当日信号：calcSignals 事件（K 线，腾讯/净值，无东财依赖）
 *
 * @module dailyReport
 */

import { db } from '@/stores/db'
import { dataSourceService } from '@/adapters/datasource/service'
import {
  computeFundTrendScore,
  localDateKey,
  type FundTrendResult,
} from '@/services/backtest/decisionSnapshot'
import { analyzeFundSectorStrength } from '@/services/sectorStrengthAnalysis'
import type {
  Comparator,
  DailyReport,
  FundHolding,
  HoldingPnlItem,
  InvestmentPlan,
  MarketPulse,
  MarketSignalItem,
  PlanAlert,
  PlanProgressItem,
  PortfolioSnapshot,
  SectorTempItem,
} from '@/types'

function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case 'lt': return value < threshold
    case 'gt': return value > threshold
    case 'lte': return value <= threshold
    case 'gte': return value >= threshold
  }
}

/** 模块1：组合盈亏快照 */
function computePortfolio(
  holdings: FundHolding[],
  quotes: Map<string, { nav: number; dailyChange: number }>,
): PortfolioSnapshot {
  const date = localDateKey()
  const items: HoldingPnlItem[] = []
  let totalMarketValue = 0
  let totalCost = 0
  let dayPnl = 0
  let totalPnl = 0

  for (const h of holdings) {
    const q = quotes.get(h.code)
    if (!q) continue
    const nav = q.nav
    // 与 scan() 一致的成本估算（兼容方式一 costNAV×shares 与方式二 holdingAmount/holdingProfit）
    const costValue =
      h.costNAV && h.shares
        ? h.costNAV * h.shares
        : h.holdingAmount
          ? h.holdingAmount - (h.holdingProfit ?? 0)
          : 0
    const costNAV =
      h.shares && h.costNAV
        ? h.costNAV
        : costValue && h.shares
          ? costValue / h.shares
          : 0
    const costKnown = costNAV > 0
    const currentValue = h.shares > 0 ? nav * h.shares : (h.holdingAmount || 0)
    // 今日盈亏与成本无关，始终按市值×涨跌幅计入
    const dp = currentValue * (q.dailyChange / 100)
    // 成本未知：收益率/累计盈亏无意义，不计入成本类聚合（避免把市值当利润虚高）
    const returnRate = costKnown ? ((nav - costNAV) / costNAV) * 100 : 0
    const tp = costKnown ? currentValue - costValue : 0

    totalMarketValue += currentValue
    dayPnl += dp
    if (costKnown) {
      totalCost += costValue
      totalPnl += tp
    }

    items.push({
      code: h.code,
      name: h.name || h.code,
      nav,
      dailyChange: q.dailyChange,
      costNAV,
      shares: h.shares,
      returnRate,
      marketValue: currentValue,
      costValue: costKnown ? costValue : 0,
      dayPnl: dp,
      totalPnl: tp,
      costKnown,
    })
  }

  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const dayPnlPct = totalMarketValue > 0 ? (dayPnl / totalMarketValue) * 100 : 0

  return {
    date,
    totalMarketValue,
    totalCost,
    totalPnl,
    totalPnlPct,
    dayPnl,
    dayPnlPct,
    prevDayMarketValue: null,
    dayPnlByPrev: null,
    prevDate: null,
    holdings: items,
  }
}

/** 模块2：当日待处理行动建议 */
async function loadTodaySuggestions(date: string): Promise<PlanAlert[]> {
  const all = await db.alerts.filter((a) => !a.executed && !a.dismissed).toArray()
  return all
    .filter((a) => localDateKey(new Date(a.triggeredAt)) === date)
    .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1))
}

/** 为所有持仓跑趋势管线（一次计算，模块3/4 共用） */
async function computeTrends(
  holdings: FundHolding[],
  etfMappings: { otcCode: string; exchangeCode: string }[],
): Promise<Map<string, FundTrendResult>> {
  const map = new Map<string, FundTrendResult>()
  for (const h of holdings) {
    try {
      const t = await computeFundTrendScore(h, etfMappings as any)
      if (t) map.set(h.code, t)
    } catch {
      // 单只失败不影响整体日报
    }
  }
  return map
}

/** 模块3：计划进度（当前指标值距阈值还差多少） */
function computePlanProgress(
  plan: InvestmentPlan | null,
  portfolio: PortfolioSnapshot,
  trends: Map<string, FundTrendResult>,
  dcaDaysSince: number | null,
): PlanProgressItem[] {
  if (!plan) return []
  const trendScores = [...trends.values()].map((t) => t.score)
  const avgTrend = trendScores.length > 0 ? trendScores.reduce((a, b) => a + b, 0) / trendScores.length : null

  return plan.rules.map((rule) => {
    let currentValue: number | null
    let note = ''

    if (!rule.enabled) {
      return {
        ruleId: rule.id,
        ruleType: rule.type,
        threshold: rule.threshold,
        comparator: rule.comparator,
        action: rule.action,
        enabled: false,
        currentValue: null,
        distance: null,
        reached: false,
        status: 'disabled' as const,
        note: '规则已停用',
      }
    }

    switch (rule.type) {
      case 'return':
        currentValue = portfolio.totalPnlPct
        break
      case 'daily_change':
        currentValue = portfolio.dayPnlPct
        break
      case 'trend':
        currentValue = avgTrend
        break
      case 'dca':
        currentValue = dcaDaysSince
        note = dcaDaysSince == null ? '尚无定投记录' : `距上次定投 ${Math.round(dcaDaysSince)} 天`
        break
      default:
        // price_diff / kline_pattern 需逐只持仓评估，无单一组合指标
        return {
          ruleId: rule.id,
          ruleType: rule.type,
          threshold: rule.threshold,
          comparator: rule.comparator,
          action: rule.action,
          enabled: true,
          currentValue: null,
          distance: null,
          reached: false,
          status: 'na' as const,
          note: '需逐只评估持仓',
        }
    }

    if (currentValue == null) {
      return {
        ruleId: rule.id,
        ruleType: rule.type,
        threshold: rule.threshold,
        comparator: rule.comparator,
        action: rule.action,
        enabled: true,
        currentValue: null,
        distance: null,
        reached: false,
        status: 'na' as const,
        note: note || '当前数据不足',
      }
    }

    const distance = rule.threshold - currentValue
    const reached = compare(currentValue, rule.comparator, rule.threshold)
    const mag = Math.abs(rule.threshold) || 1
    const nearBand = Math.max(3, mag * 0.3)
    const status: PlanProgressItem['status'] = reached
      ? 'reached'
      : Math.abs(distance) <= nearBand
        ? 'near'
        : 'far'

    return {
      ruleId: rule.id,
      ruleType: rule.type,
      threshold: rule.threshold,
      comparator: rule.comparator,
      action: rule.action,
      enabled: true,
      currentValue,
      distance,
      reached,
      status,
      note,
    }
  })
}

/** 模块4：板块温度 + 当日信号 */
async function computeMarketPulse(
  holdings: FundHolding[],
  etfMappings: { otcCode: string; exchangeCode: string }[],
  eastmoneyEnabled: boolean,
  trends: Map<string, FundTrendResult>,
  marketValueOf: (code: string) => number,
): Promise<MarketPulse> {
  const signals: MarketSignalItem[] = []
  for (const h of holdings) {
    const t = trends.get(h.code)
    if (!t) continue
    for (const s of t.signals) {
      signals.push({
        code: h.code,
        name: h.name || h.code,
        type: s.type,
        label: s.label,
        date: s.date,
        direction: s.direction,
      })
    }
  }
  // 按日期倒序，取最近 15 条
  signals.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const topSignals = signals.slice(0, 15)

  const lowConfidenceCount = [...trends.values()].filter((t) => t.lowConfidence).length

  // 板块温度（东财增强门控）
  if (!eastmoneyEnabled) {
    return { sectorEnabled: false, sectorTemp: [], avgSectorScore: null, signals: topSignals, lowConfidenceCount }
  }

  const eastmoneyConfig = (await db.settings.toArray())[0]?.dataSource?.eastmoney || {
    enabled: true,
    mode: 'proxy' as const,
    proxyUrl: '',
  }
  const sectorTemp: SectorTempItem[] = []
  let wSum = 0
  let scoreAcc = 0
  for (const h of holdings) {
    try {
      const sector = await analyzeFundSectorStrength(h, etfMappings as any, eastmoneyConfig)
      if (!sector || sector.combinedScore == null) continue
      const con = sector.conceptScore
      // combinedScore 已是 0-100（±4.17% 映射），反推板块近似涨跌幅用于展示
      const changePercent = (sector.combinedScore - 50) / 12
      sectorTemp.push({
        name: h.name || h.code,
        changePercent,
        score: sector.combinedScore,
        source: con != null ? 'concept' : 'industry',
      })
      // 板块温度均分按持仓市值加权
      const w = marketValueOf(h.code) || 1
      wSum += w
      scoreAcc += sector.combinedScore * w
    } catch {
      // 单只失败跳过
    }
  }
  sectorTemp.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  return {
    sectorEnabled: true,
    sectorTemp,
    avgSectorScore: wSum > 0 ? scoreAcc / wSum : null,
    signals: topSignals,
    lowConfidenceCount,
  }
}

/** 查询距上次定投（dca alert）的天数 */
async function daysSinceLastDca(): Promise<number | null> {
  const dcaAlerts = await db.alerts.filter((a) => a.ruleType === 'dca').toArray()
  if (dcaAlerts.length === 0) return null
  const last = dcaAlerts.reduce((m, a) => (a.triggeredAt > m ? a.triggeredAt : m), dcaAlerts[0].triggeredAt)
  return (Date.now() - new Date(last).getTime()) / 86400000
}

/**
 * 生成今日日报（幂等：同一 date 覆盖写入）。
 * @param holdings 当前持仓列表
 * @returns 生成的 DailyReport；无持仓时返回 null
 */
export async function generateDailyReport(holdings: FundHolding[]): Promise<DailyReport | null> {
  if (!holdings.length) return null

  const settingsList = await db.settings.toArray()
  const settings = settingsList[0]
  const etfMappings = (settings?.etfMappings || []) as { otcCode: string; exchangeCode: string }[]
  const eastmoneyEnabled = !!settings?.dataSource?.eastmoney?.enabled

  const date = localDateKey()

  // 行情
  const quotesRaw = await dataSourceService.fetchQuotes(holdings.map((h) => h.code))
  const quotes = new Map(quotesRaw.map((q) => [q.code, { nav: q.nav, dailyChange: q.dailyChange }]))

  // 模块1
  const portfolio = computePortfolio(holdings, quotes)

  // 昨日对比
  const prevReports = await db.dailyReports.orderBy('date').reverse().toArray()
  const prev = prevReports.find((r) => r.date < date) || null
  if (prev) {
    portfolio.prevDayMarketValue = prev.portfolio.totalMarketValue
    portfolio.prevDate = prev.date
    portfolio.dayPnlByPrev = portfolio.totalMarketValue - prev.portfolio.totalMarketValue
  }

  // 模块2 + 趋势（趋势一次计算供模块3/4）
  const [suggestions, trends, dcaDays, plan] = await Promise.all([
    loadTodaySuggestions(date),
    computeTrends(holdings, etfMappings),
    daysSinceLastDca(),
    db.plans.get('global-plan'),
  ])

  // 模块3
  const planProgress = computePlanProgress(plan, portfolio, trends, dcaDays)

  // 模块4
  const mvMap = new Map(portfolio.holdings.map((i) => [i.code, i.marketValue]))
  const market = await computeMarketPulse(
    holdings,
    etfMappings,
    eastmoneyEnabled,
    trends,
    (code) => mvMap.get(code) || 0,
  )

  const report: DailyReport = {
    date,
    portfolio,
    suggestions,
    planProgress,
    market,
    generatedAt: new Date().toISOString(),
  }

  await db.dailyReports.put(report)
  return report
}

/** 读取最近 N 份日报（按日期倒序） */
export async function getRecentDailyReports(limit = 30): Promise<DailyReport[]> {
  const all = await db.dailyReports.orderBy('date').reverse().toArray()
  return all.slice(0, limit)
}

/** 读取指定日期日报 */
export async function getDailyReport(date: string): Promise<DailyReport | null> {
  return (await db.dailyReports.get(date)) || null
}
