/**
 * 基金分红派送历史查询（东财增强，门控能力）
 *
 * 数据源：stock-sdk 的 sdk.fund.dividendList({ code, page: 'all' })，走东方财富。
 * 返回该基金的分红送配历史（权益登记日 / 除息日 / 每份分红 / 发放日）。
 *
 * 门控：仅当 settings.dataSource.eastmoney.enabled 为 true 才执行；否则直接返回 null，
 *       不产生任何东财请求（App 行为与关闭前完全一致）。
 *
 * 优雅降级：取数失败（网络不可达 / 上游无该基金分红）时整体返回 null，上层跳过该维度。
 *
 * @module fundDividend
 */

import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import type { EastmoneyDataSourceConfig } from "@/types";

/** 单条分红记录（对齐 stock-sdk FundDividend，容忍缺值） */
export interface DividendItem {
  /** 权益登记日 YYYY-MM-DD */
  equityRecordDate: string | null;
  /** 除息日 YYYY-MM-DD */
  exDividendDate: string | null;
  /** 每份分红（元/份），无值为 null */
  dividendPerShare: number | null;
  /** 发放日 YYYY-MM-DD */
  payDate: string | null;
  /** 分红类型代码（接口原始口径，如派现/拆分），无值为 null */
  dividendType: string | null;
}

/** 单只基金的分红派送结果 */
export interface FundDividendResult {
  enabled: true;
  code: string;
  name: string | null;
  /** 分红记录（按除息日降序） */
  items: DividendItem[];
  /** 累计每份分红（元/份），用于展示「累计分红再投资」强度 */
  totalPerShare: number;
  fetchedAt: number;
}

/**
 * 拉取单只基金的分红派送历史。
 * @returns enabled=false 或取数失败/无数据时返回 null（上层跳过该维度）。
 */
export async function fetchFundDividend(
  code: string,
  config: EastmoneyDataSourceConfig,
): Promise<FundDividendResult | null> {
  if (!config.enabled) return null;
  if (!code) return null;

  const sdk = buildEastmoneySdk(config);
  try {
    const raw = await sdk.fund.dividendList({ code, page: "all" });
    const all = Array.isArray(raw?.items) ? raw.items : [];
    // 接口按 code 过滤是客户端过滤，二次保险只保留目标基金
    const items: DividendItem[] = all
      .filter((d): d is NonNullable<typeof d> => !!d && d.code === code)
      .map((d) => ({
        equityRecordDate: d.equityRecordDate ?? null,
        exDividendDate: d.exDividendDate ?? null,
        dividendPerShare: typeof d.dividendPerShare === "number" ? d.dividendPerShare : null,
        payDate: d.payDate ?? null,
        dividendType: d.dividendType ?? null,
      }))
      .sort((a, b) => String(b.exDividendDate ?? "").localeCompare(String(a.exDividendDate ?? "")));
    if (items.length === 0) return null;

    const totalPerShare = items.reduce((s, d) => s + (d.dividendPerShare || 0), 0);
    return {
      enabled: true,
      code,
      name: raw?.name ?? null,
      items,
      totalPerShare,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
