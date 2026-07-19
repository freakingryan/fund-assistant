/**
 * 资金面间接分析（东财增强，门控能力）
 *
 * 思路：基金本身没有"资金流向/北向"数据，但已配置「ETF 映射」与「前十大重仓股」，
 * 重仓股是 A 股、ETF 是场内品种，二者都有完整的资金面数据。本服务对一只基金：
 *   - 有 ETF 映射 → 直接取该 ETF 的资金流向；
 *   - 否则 → 对前十大重仓股（按占净值比例 ratio 加权）聚合 主力净流入 + 北向增持，
 *     反推出基金级「资金面分 / 北向分」。
 *
 * 数据源：stock-sdk 的 fundFlow / northbound（均走东方财富）。
 * 门控：仅当 settings.dataSource.eastmoney.enabled 为 true 才执行；否则直接返回 null，
 *       不产生任何东财请求，App 行为与关闭前完全一致。
 *
 * 优雅降级：每个重仓股/ETF 的资金面请求独立 try/catch，单只失败仅该只缺数据，
 *           不中断整体；网络不可达时整体返回 null（上层跳过该维度）。
 *
 * Worker 切换：mode='proxy' 时通过注入自定义 fetchImpl，把所有发往 *.eastmoney.com
 *            的请求改写到 proxyUrl（Cloudflare Worker）。约定 Worker 转发时保留原 path+query。
 *
 * @module capitalFlowAnalysis
 */

import { dataSourceService } from '@/adapters/datasource/service'
import { buildEastmoneySdk } from '@/services/eastmoneySdk'
import type { EastmoneyDataSourceConfig, EtfMapping, FundHolding } from '@/types'
import type { CapitalFlowBreakdownItem } from '@/services/backtest/types'

/** 单只基金的资金面分析结果 */
export interface CapitalFlowResult {
  enabled: true
  /** 加权主力净流入分（0-100），null 表示无可用数据 */
  capitalScore: number | null
  /** 加权北向增持分（0-100），null 表示无可用数据 */
  northboundScore: number | null
  /** 综合资金面分（0-100），capital 0.6 + northbound 0.4 */
  combinedScore: number | null
  breakdown: CapitalFlowBreakdownItem[]
  fetchedAt: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 主力净流入净占比(%) → 0-100 分（±12.5% 映射到 0-100） */
function capitalPctToScore(pct: number): number {
  return clamp(50 + pct * 4, 0, 100)
}

/** 北向持股变化(%) → 0-100 分（±2.5% 映射到 0-100） */
function northboundDeltaToScore(deltaPct: number): number {
  return clamp(50 + deltaPct * 20, 0, 100)
}

interface AnalysisUnit {
  symbol: string
  name?: string
  weight: number
}

/**
 * 分析单只基金的资金面（间接法）。
 * @returns enabled=false 或取数失败时返回 null（上层跳过该维度）。
 */
export async function analyzeFundCapitalFlow(
  fund: FundHolding,
  etfMappings: EtfMapping[],
  config: EastmoneyDataSourceConfig,
): Promise<CapitalFlowResult | null> {
  if (!config.enabled) return null

  const etfCode = etfMappings.find((m) => m.otcCode === fund.code)?.exchangeCode || null

  // 取重仓股（仅 enabled 时才取，避免关闭时产生东财请求）
  let units: AnalysisUnit[] = []
  if (etfCode) {
    units = [{ symbol: etfCode, name: etfCode, weight: 1 }]
  } else {
    try {
      const portfolio = await dataSourceService.fetchFundPortfolio(fund.code)
      if (portfolio?.holdings?.length) {
        units = portfolio.holdings
          .filter((h) => h.code && h.ratio > 0)
          .map((h) => ({ symbol: h.code, name: h.name, weight: h.ratio }))
      }
    } catch {
      units = []
    }
  }
  if (units.length === 0) return null

  const sdk = buildEastmoneySdk(config)
  const breakdown: CapitalFlowBreakdownItem[] = []

  for (const unit of units) {
    let capitalPercent: number | null = null
    let northboundDeltaPct: number | null = null
    try {
      const flow = await sdk.fundFlow.individual(unit.symbol, { period: 'daily' })
      if (flow?.length) {
        const recent = flow.slice(-5)
        const valid = recent.map((d) => d.mainNetInflowPercent).filter((v): v is number => typeof v === 'number')
        if (valid.length) capitalPercent = valid.reduce((a, b) => a + b, 0) / valid.length
      }
    } catch {
      capitalPercent = null
    }
    try {
      const nb = await sdk.northbound.individual(unit.symbol)
      if (nb?.length >= 2) {
        const prev = nb[nb.length - 2].holdShares
        const cur = nb[nb.length - 1].holdShares
        if (prev && cur != null) northboundDeltaPct = ((cur - prev) / prev) * 100
      }
    } catch {
      northboundDeltaPct = null
    }
    breakdown.push({ symbol: unit.symbol, name: unit.name, weight: unit.weight, capitalPercent, northboundDeltaPct })
  }

  // 加权聚合（按 weight 归一）
  let wSum = 0
  let capAcc = 0
  let nbAcc = 0
  for (const b of breakdown) {
    const w = b.weight > 0 ? b.weight : 0
    wSum += w
    if (b.capitalPercent != null) capAcc += capitalPctToScore(b.capitalPercent) * w
    if (b.northboundDeltaPct != null) nbAcc += northboundDeltaToScore(b.northboundDeltaPct) * w
  }
  const capitalScore = wSum > 0 ? capAcc / wSum : null
  const northboundScore = wSum > 0 ? nbAcc / wSum : null

  const combinedScore =
    capitalScore != null && northboundScore != null
      ? capitalScore * 0.6 + northboundScore * 0.4
      : (capitalScore ?? northboundScore)

  return {
    enabled: true,
    capitalScore,
    northboundScore,
    combinedScore,
    breakdown,
    fetchedAt: Date.now(),
  }
}
