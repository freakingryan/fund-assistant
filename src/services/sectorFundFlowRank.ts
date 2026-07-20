/**
 * 全市场板块资金流排行
 *
 * 封装 stock-sdk 的 `sdk.fundFlow.sectorRank`，返回主力净流入排好序的板块列表。
 * 复用应用共享的东财 SDK 实例（buildEastmoneySdk），受「东财增强」开关门控。
 * 用户网络已实测直连东财可达，无需 Cloudflare Worker。
 *
 * 与「板块温度」（按持仓重仓股聚合）的区别：本接口是全市场板块级资金流，
 * 不依赖用户持仓，回答「今天哪些板块在吸金 / 出逃」。
 *
 * @module sectorFundFlowRank
 */

import type { FundFlowRankOptions, SectorFundFlowItem } from 'stock-sdk'
import { buildEastmoneySdk } from '@/services/eastmoneySdk'
import { useSettingsStore } from '@/stores/settings'

export type SectorFlowType = NonNullable<FundFlowRankOptions['sectorType']>
export type FlowIndicator = NonNullable<FundFlowRankOptions['indicator']>

export interface SectorFundFlowParams {
  sectorType?: SectorFlowType
  indicator?: FlowIndicator
}

export const FLOW_TYPE_LABELS: Record<SectorFlowType, string> = {
  industry: '行业',
  concept: '概念',
  region: '地域',
}

export const FLOW_INDICATOR_LABELS: Record<FlowIndicator, string> = {
  today: '今日',
  '3day': '3日',
  '5day': '5日',
  '10day': '10日',
}

/** 东财增强未开启时抛出，面板据此展示占位提示。 */
export class EastmoneyDisabledError extends Error {
  constructor() {
    super('EASTMONEY_DISABLED')
    this.name = 'EastmoneyDisabledError'
  }
}

/**
 * 取全市场板块资金流排行。
 * 结果按主力净流入（元）降序排列：前 N 为净流入最大（吸金），后 N 为净流出最大（出逃）。
 */
export async function fetchSectorFundFlowRank(
  params: SectorFundFlowParams = {},
): Promise<SectorFundFlowItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney
  if (!config.enabled) throw new EastmoneyDisabledError()

  const sdk = buildEastmoneySdk(config)
  const items = await sdk.fundFlow.sectorRank({
    sectorType: params.sectorType ?? 'industry',
    indicator: params.indicator ?? 'today',
  })

  return [...items].sort(
    (a, b) => (b.mainNetInflow ?? -Infinity) - (a.mainNetInflow ?? -Infinity),
  )
}
