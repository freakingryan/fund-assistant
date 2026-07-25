/**
 * 打板情绪 / 涨停池
 *
 * 封装 stock-sdk 的 `sdk.marketEvent.ztPool`（涨停池）与 `sdk.marketEvent.stockChanges`
 * （涨跌停 / 炸板等盘口异动）。复用应用共享东财 SDK 实例（buildEastmoneySdk），
 * 受「东财增强」开关门控。遵循评估 §7.4「不自建东财解析、不引入 Python」原则。
 *
 * @module marketSentiment
 */

import type { ZTPoolItem, StockChangeItem, ZTPoolType, StockChangeType } from "stock-sdk";
import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
import { useSettingsStore } from "@/stores/settings";

/** 涨停池类型 → 中文标签（对应 stock-sdk ZTPoolType 枚举） */
export const ZT_POOL_LABELS: Record<ZTPoolType, string> = {
  zt: "涨停",
  yesterday: "昨涨停",
  strong: "强势",
  sub_new: "次新",
  broken: "炸板",
  dt: "跌停",
};

/** 涨停池（按 type：涨停/昨涨停/强势/次新/炸板/跌停） */
export async function fetchLimitUpPool(type?: ZTPoolType): Promise<ZTPoolItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.marketEvent.ztPool(type);
}

/** 盘口异动（涨跌停 / 炸板等）；默认 'all' 取全部类型 */
export async function fetchStockChanges(
  type: StockChangeType | StockChangeType[] | "all" = "all",
): Promise<StockChangeItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.marketEvent.stockChanges(type);
}

export { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
