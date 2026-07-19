/**
 * 板块赛道强度间接分析（东财增强，门控能力）
 *
 * 思路：基金本身没有「板块/赛道」标签，但已配置「ETF 映射」与「前十大重仓股」，
 * 重仓股（A 股）与 ETF 都属于具体行业/概念板块。本服务对一只基金：
 *   - 有 ETF 映射 → 直接取该 ETF 所属行业/概念板块；
 *   - 否则 → 对前十大重仓股（按占净值比例 ratio 加权）聚合其所属板块的当日强度，
 *     反推出基金级「板块赛道分」。
 *
 * 板块强度来源：stock-sdk 的 board.industry / board.concept（均走东方财富）：
 *   - board.industry.list() / board.concept.list()：一次性取全部板块及其 changePercent（强度），
 *     模块内按采集批次缓存，避免每只基金重复拉全量。
 *   - board.industry.constituents(stock) / board.concept.constituents(stock)：给定个股代码，
 *     返回其所属板块（含板块 code/name 与该股在板块内的 changePercent）。
 *
 * 门控：仅当 settings.dataSource.eastmoney.enabled 为 true 才执行；否则直接返回 null，
 *       不产生任何东财请求。
 *
 * 优雅降级：每只重仓股/ETF 的板块请求独立 try/catch，单只失败仅缺该只数据；
 *           板块列表拉取失败时整体返回 null（上层跳过该维度）。
 *
 * @module sectorStrengthAnalysis
 */

import StockSDK from 'stock-sdk'
import { dataSourceService } from '@/adapters/datasource/service'
import { buildEastmoneySdk } from '@/services/eastmoneySdk'
import type { EastmoneyDataSourceConfig, EtfMapping, FundHolding } from '@/types'
import type { SectorStrengthBreakdownItem } from '@/services/backtest/types'

/** 单只基金的分析结果 */
export interface SectorStrengthResult {
  enabled: true
  /** 行业板块加权强度分（0-100），null 表示无可用数据 */
  industryScore: number | null
  /** 概念（赛道）板块加权强度分（0-100），null 表示无可用数据 */
  conceptScore: number | null
  /** 综合板块赛道分（0-100）：行业与概念各 0.5，缺一则取有值者 */
  combinedScore: number | null
  breakdown: SectorStrengthBreakdownItem[]
  fetchedAt: number
}

interface BoardMapEntry {
  code: string
  name: string
  changePercent: number | null
}

interface BoardMaps {
  industry: Map<string, BoardMapEntry>
  concept: Map<string, BoardMapEntry>
  at: number
}

/** 采集批次内缓存板块全量列表（5 分钟有效期），跨基金复用，避免重复拉全量 */
let boardMapsCache: BoardMaps | null = null
const BOARD_MAPS_TTL = 5 * 60 * 1000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 板块当日涨跌幅(%) → 0-100 分（±4.17% 映射到 0-100） */
function changePercentToScore(pct: number): number {
  return clamp(50 + pct * 12, 0, 100)
}

/**
 * 拉取并缓存全部板块（行业 + 概念）的强度映射。
 * 返回 code→板块强度 的 Map，键同时包含板块 code 与 name 以兼容 constituents 的不同返回形态。
 */
async function getBoardMaps(sdk: StockSDK): Promise<BoardMaps> {
  if (boardMapsCache && Date.now() - boardMapsCache.at < BOARD_MAPS_TTL) {
    return boardMapsCache
  }
  const buildMap = (list: any[]): Map<string, BoardMapEntry> => {
    const m = new Map<string, BoardMapEntry>()
    for (const b of list || []) {
      if (!b) continue
      const entry: BoardMapEntry = {
        code: b.code,
        name: b.name,
        changePercent: typeof b.changePercent === 'number' ? b.changePercent : null,
      }
      if (b.code) m.set(b.code, entry)
      if (b.name) m.set(b.name, entry) // 兼容 constituents 可能返回板块 name 的情况
    }
    return m
  }
  const [industryList, conceptList] = await Promise.all([
    sdk.board.industry.list().catch(() => []),
    sdk.board.concept.list().catch(() => []),
  ])
  const maps: BoardMaps = {
    industry: buildMap(industryList),
    concept: buildMap(conceptList),
    at: Date.now(),
  }
  boardMapsCache = maps
  return maps
}

/** 从 constituents 的返回里解析出该个股所属板块的强度（-changePercent） */
function resolveBoardStrength(
  constituents: any[] | null | undefined,
  maps: Map<string, BoardMapEntry>,
): number[] {
  if (!constituents?.length) return []
  const strengths: number[] = []
  for (const c of constituents) {
    if (!c) continue
    // constituents 返回项可能是「板块」实体（code/name 为板块），也可能携带自身 changePercent
    const fromMap =
      (c.code && maps.get(c.code)?.changePercent) ?? (c.name && maps.get(c.name)?.changePercent) ?? null
    const direct = typeof c.changePercent === 'number' ? c.changePercent : null
    const pct = fromMap != null ? fromMap : direct
    if (pct != null) strengths.push(pct)
  }
  return strengths
}

interface AnalysisUnit {
  symbol: string
  name?: string
  weight: number
}

/**
 * 分析单只基金的板块赛道强度（间接法）。
 * @returns enabled=false 或取数失败时返回 null（上层跳过该维度）。
 */
export async function analyzeFundSectorStrength(
  fund: FundHolding,
  etfMappings: EtfMapping[],
  config: EastmoneyDataSourceConfig,
): Promise<SectorStrengthResult | null> {
  if (!config.enabled) return null

  const etfCode = etfMappings.find((m) => m.otcCode === fund.code)?.exchangeCode || null

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
  const maps = await getBoardMaps(sdk).catch(() => null)
  if (!maps) return null

  const breakdown: SectorStrengthBreakdownItem[] = []

  for (const unit of units) {
    const industryPcts = await sdk.board.industry
      .constituents(unit.symbol)
      .then((cons) => resolveBoardStrength(cons, maps.industry))
      .catch(() => [] as number[])
    const conceptPcts = await sdk.board.concept
      .constituents(unit.symbol)
      .then((ccons) => resolveBoardStrength(ccons, maps.concept))
      .catch(() => [] as number[])
    const industryChange =
      industryPcts.length > 0 ? industryPcts.reduce((a, b) => a + b, 0) / industryPcts.length : null
    const conceptChange =
      conceptPcts.length > 0 ? conceptPcts.reduce((a, b) => a + b, 0) / conceptPcts.length : null
    breakdown.push({
      symbol: unit.symbol,
      name: unit.name,
      weight: unit.weight,
      industryChangePercent: industryChange,
      conceptChangePercent: conceptChange,
    })
  }

  // 按 weight 归一加权聚合
  let wSum = 0
  let indAcc = 0
  let conAcc = 0
  let indHas = false
  let conHas = false
  for (const b of breakdown) {
    const w = b.weight > 0 ? b.weight : 0
    wSum += w
    if (b.industryChangePercent != null) {
      indAcc += changePercentToScore(b.industryChangePercent) * w
      indHas = true
    }
    if (b.conceptChangePercent != null) {
      conAcc += changePercentToScore(b.conceptChangePercent) * w
      conHas = true
    }
  }

  const industryScore = wSum > 0 && indHas ? indAcc / wSum : null
  const conceptScore = wSum > 0 && conHas ? conAcc / wSum : null
  const combinedScore =
    industryScore != null && conceptScore != null
      ? industryScore * 0.5 + conceptScore * 0.5
      : (industryScore ?? conceptScore)

  return {
    enabled: true,
    industryScore,
    conceptScore,
    combinedScore,
    breakdown,
    fetchedAt: Date.now(),
  }
}
