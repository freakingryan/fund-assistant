/**
 * 基金「同类排名走势」查询（东财增强，门控能力）
 *
 * 数据源：stock-sdk 的 sdk.fund.rankHistory(code)（走东方财富 pingzhongdata / fundf10）。
 * 返回该基金在【同类近三月】维度下的排名走势序列（rank/total/percentile 按日期升序）。
 *   - rank：同类近三月排名，数字越小越靠前；
 *   - total：同类基金总数；
 *   - percentile：同类近三月排名百分位(%)，越小越好（前 X%）。
 *
 * 门控：仅当 settings.dataSource.eastmoney.enabled 为 true 才执行；否则直接返回 null，
 *       不产生任何东财请求（App 行为与关闭前完全一致）。
 *
 * 优雅降级：取数失败（网络不可达 / 上游无该基金排名）时整体返回 null，上层跳过该维度。
 *
 * @module fundRankHistory
 */

import { buildEastmoneySdk } from '@/services/eastmoneySdk'
import type { EastmoneyDataSourceConfig } from '@/types'

/** 单个排名走势点（对齐 stock-sdk FundRankPoint，容忍缺值） */
export interface RankPoint {
  /** 报告日期 YYYY-MM-DD */
  date: string
  /** 同类近三月排名（越小越靠前），无值为 null */
  rank: number | null
  /** 同类基金总数，无值为 null */
  total: number | null
  /** 同类近三月排名百分位(%)，越小越好，无值为 null */
  percentile: number | null
}

/** 单只基金的同类排名走势结果 */
export interface FundRankHistoryResult {
  enabled: true
  code: string
  name: string | null
  /** 排名走势序列（按日期升序，可能含缺值点） */
  items: RankPoint[]
  /** 最新一个「有 percentile 值」的排名点，无有效点时为 null */
  latest: RankPoint | null
  fetchedAt: number
}

/**
 * 拉取单只基金的同类排名走势（近三月口径）。
 * @returns enabled=false 或取数失败/无数据时返回 null（上层跳过该维度）。
 */
export async function fetchFundRankHistory(
  code: string,
  config: EastmoneyDataSourceConfig,
): Promise<FundRankHistoryResult | null> {
  if (!config.enabled) return null
  if (!code) return null

  const sdk = buildEastmoneySdk(config)
  try {
    const raw = await sdk.fund.rankHistory(code)
    const rawItems = Array.isArray(raw?.items) ? raw.items : []
    const items: RankPoint[] = rawItems
      .filter((p): p is NonNullable<typeof p> => !!p && typeof p.date === 'string')
      .map((p) => ({
        date: p.date,
        rank: typeof p.rank === 'number' ? p.rank : null,
        total: typeof p.total === 'number' ? p.total : null,
        percentile: typeof p.percentile === 'number' ? p.percentile : null,
      }))
    if (items.length === 0) return null

    // 最新的「有 percentile 值」点（序列按日期升序，从尾部回溯）
    let latest: RankPoint | null = null
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].percentile != null) {
        latest = items[i]
        break
      }
    }

    return {
      enabled: true,
      code: raw?.code || code,
      name: raw?.name ?? null,
      items,
      latest,
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}
