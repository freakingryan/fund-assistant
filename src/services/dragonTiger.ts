/**
 * 龙虎榜
 *
 * 封装 stock-sdk 的 `sdk.dragonTiger.stockStats`（上榜个股统计）与 `sdk.dragonTiger.detail`
 * （当日龙虎榜明细）。复用应用共享东财 SDK 实例（buildEastmoneySdk），受「东财增强」开关门控。
 * 遵循评估 §7.4「不自建东财解析、不引入 Python」原则。
 *
 * @module dragonTiger
 */

import type {
  DragonTigerStockStatItem,
  DragonTigerDetailItem,
  DragonTigerDateOptions,
  DragonTigerPeriod,
} from "stock-sdk";
import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
import { useSettingsStore } from "@/stores/settings";

/** 上榜个股统计（近 N 日上榜次数 / 净额等） */
export async function fetchDragonTigerStockStats(
  period?: DragonTigerPeriod,
): Promise<DragonTigerStockStatItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.dragonTiger.stockStats(period);
}

/** 当日龙虎榜明细（买卖席位 TOP / 机构动向） */
export async function fetchDragonTigerDetail(
  options?: DragonTigerDateOptions,
): Promise<DragonTigerDetailItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.dragonTiger.detail(options ?? {});
}

export { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
