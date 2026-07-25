/**
 * 东财交叉截面因子（资金面 / 板块赛道 / 同类排名）
 *
 * 设计：复用项目已有的东财门控分析（capitalFlowAnalysis / sectorStrengthAnalysis /
 * fundRankHistory），它们均仅在 settings.dataSource.eastmoney.enabled 时执行，
 * 失败整体返回 null（上层跳过该维度）。本模块把这些结果规整为带 `available` 标志的
 * `EmFactors`，供决策引擎以「叠加层(overlay)」方式注入评分 —— 缺省 available:false
 * → 增量恒为 0 → 评分与纯本地完全一致（graceful degradation 硬约束）。
 *
 * @module decision/eastmoneyFactors
 */

import type { EastmoneyDataSourceConfig, EtfMapping, FundHolding } from "@/types";
import { analyzeFundCapitalFlow } from "@/services/capitalFlowAnalysis";
import { analyzeFundSectorStrength } from "@/services/sectorStrengthAnalysis";
import { fetchFundRankHistory } from "@/services/fundRankHistory";

export interface EmFactorCapital {
  available: boolean;
  /** 综合资金面分 0-100，50 为中性 */
  combinedScore: number | null;
}
export interface EmFactorSector {
  available: boolean;
  /** 综合板块赛道分 0-100，50 为中性 */
  combinedScore: number | null;
}
export interface EmFactorPeer {
  available: boolean;
  /** 同类近三月排名百分位(%)，越小越好 */
  percentile: number | null;
}

export interface EmFactors {
  capitalFlow: EmFactorCapital;
  sector: EmFactorSector;
  peerRank: EmFactorPeer;
}

/** 全部不可用（东财关闭 / 取数失败）的空因子，叠加后增量为 0 */
export const EMPTY_EM_FACTORS: EmFactors = {
  capitalFlow: { available: false, combinedScore: null },
  sector: { available: false, combinedScore: null },
  peerRank: { available: false, percentile: null },
};

/**
 * 从已取数的结果（快照采集路径，避免重复请求）构建 EmFactors。
 */
export function buildEmFromResults(
  capital: { combinedScore: number | null } | null,
  sector: { combinedScore: number | null } | null,
  rankHist: { latest: { percentile: number | null } | null } | null,
): EmFactors {
  return {
    capitalFlow: {
      available: !!capital && capital.combinedScore != null,
      combinedScore: capital?.combinedScore ?? null,
    },
    sector: {
      available: !!sector && sector.combinedScore != null,
      combinedScore: sector?.combinedScore ?? null,
    },
    peerRank: {
      available: rankHist?.latest?.percentile != null,
      percentile: rankHist?.latest?.percentile ?? null,
    },
  };
}

/**
 * 异步取东财三类因子。门控：enabled=false 时三个函数直接返回 null。
 * 任一失败 → 该项 available:false。整体失败返回 EMPTY_EM_FACTORS，不抛异常。
 */
export async function collectEastmoneyFactors(
  fund: FundHolding,
  etfMappings: EtfMapping[],
  config: EastmoneyDataSourceConfig,
): Promise<EmFactors> {
  const [capital, sector, rankHist] = await Promise.all([
    analyzeFundCapitalFlow(fund, etfMappings, config).catch(() => null),
    analyzeFundSectorStrength(fund, etfMappings, config).catch(() => null),
    fetchFundRankHistory(fund.code, config).catch(() => null),
  ]);
  return buildEmFromResults(capital, sector, rankHist);
}
