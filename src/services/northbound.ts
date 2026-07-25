/**
 * 北向资金（沪深港通）
 *
 * 封装 stock-sdk 的 `sdk.northbound.summary`（当日净流汇总）、`holdingRank`（北向持仓排名）、
 * `minute`（分时净流）。复用应用共享东财 SDK 实例（buildEastmoneySdk），受「东财增强」开关门控。
 * 遵循评估 §7.4「不自建东财解析、不引入 Python」原则。
 *
 * 关联说明：北向 `holdingRank` 为 A 股个股，而 fund-assistant 持仓为基金（FundHolding.code 是
 * 基金代码），二者代码空间不同，无法直接交叉；如需「命中持仓基金重仓股」需重仓股穿透（P1/P2），
 * 本轮北向卡仅展示市场级资金信号。
 *
 * @module northbound
 */

import type {
  NorthboundFlowSummary,
  NorthboundHoldingRankItem,
  NorthboundMinuteItem,
  NorthboundHoldingRankOptions,
  NorthboundDirection,
} from "stock-sdk";
import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
import { useSettingsStore } from "@/stores/settings";

/** 当日北向资金净流汇总（沪股通 / 深股通 / 港股通等） */
export async function fetchNorthboundSummary(): Promise<NorthboundFlowSummary[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.northbound.summary();
}

/** 北向持仓排名（个股） */
export async function fetchNorthboundHoldingRank(
  options?: NorthboundHoldingRankOptions,
): Promise<NorthboundHoldingRankItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.northbound.holdingRank(options);
}

/** 北向资金分时净流 */
export async function fetchNorthboundMinute(
  direction?: NorthboundDirection,
): Promise<NorthboundMinuteItem[]> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  return sdk.northbound.minute(direction);
}

export { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
