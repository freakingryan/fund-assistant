/**
 * 研报中心（东方财富 reportapi）
 *
 * 封装 stock-sdk 的 `sdk.report.list`，拉取个股/ETF 的研报列表（评级 + 三年 EPS 预测 + PDF）。
 * 复用应用共享东财 SDK 实例（buildEastmoneySdk），受「东财增强」开关门控。
 * 遵循评估 §7.4「不自建东财解析、不引入 Python」原则。
 *
 * 关联说明：研报是**个股/ETF 维度**数据，而 fund-assistant 持仓为基金（FundHolding.code 是
 * 基金代码）。本卡挂在基金详情页时，用该基金的关联场内 ETF 代码（`etfCode`）作为查询标的；
 * 非 ETF 基金暂无单一关联标的，卡片提示「仅 ETF/场内基金可展示研报」。
 *
 * @module researchReport
 */

import type { ResearchReport, ResearchReportListResult } from "stock-sdk";
import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
import { useSettingsStore } from "@/stores/settings";

export interface FetchResearchReportsOptions {
  /** 个股 / ETF 代码（纯 6 位，如 600519 / 510050） */
  stockCode: string;
  /** 每页大小，默认 20 */
  pageSize?: number;
  /** 最大拉取页数（安全阀），默认 2 */
  maxPages?: number;
  /** 起始日期 YYYY-MM-DD，默认近 2 年 */
  beginTime?: string;
  /** 结束日期 YYYY-MM-DD，默认今天 */
  endTime?: string;
}

/** 默认起始日期：近 2 年（研报时效性强，无需拉全历史） */
function defaultBeginTime(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

/** 研报列表（个股 / ETF） */
export async function fetchResearchReports(
  opts: FetchResearchReportsOptions,
): Promise<ResearchReportListResult> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  // 守卫：stock-sdk 2.4.0 facade 无 report getter（sdk.report 运行时为 undefined，
  // 类型却声明存在 → 类型/运行时不匹配）。缺服务时优雅降级为禁用态，而非抛 TypeError 污染错误态。
  if (typeof (sdk as { report?: unknown }).report?.list !== "function") {
    throw new EastmoneyDisabledError();
  }
  return sdk.report.list({
    type: "stock",
    code: opts.stockCode,
    pageSize: opts.pageSize ?? 20,
    maxPages: opts.maxPages ?? 2,
    beginTime: opts.beginTime ?? defaultBeginTime(),
    endTime: opts.endTime,
  });
}

export { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
export type { ResearchReport, ResearchReportListResult };
