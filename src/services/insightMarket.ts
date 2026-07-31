/**
 * 观点回测 · 市场快照构建
 *
 * 录入投资观点时，自动抓取「观点所属交易日」的宽基指数 + 各主题映射 ETF 当日涨跌，
 * 作为 AI 分析上下文并随记录持久化（回看可复现「当日市场动向」）。
 *
 * 涨跌计算：取最近 ~120 根日 K，定位到 date（或 date 之前最近一根），
 * 用该根收盘 vs 前一根收盘算涨跌幅%。数据走腾讯 K 线（浏览器直连 CORS*）。
 *
 * @module services/insightMarket
 */

import type { MarketSnapshot, ThemeMapping } from "@/types";
import { fetchTencentKline } from "@/adapters/datasource/tencentKline";

/** 默认纳入快照的宽基指数（A 股基准） */
const BENCHMARK_INDEXES: Array<{ code: string; name: string }> = [
  { code: "000300", name: "沪深300" },
  { code: "000985", name: "中证全指" },
];

/** K 线取数根数：覆盖足够历史以支持较早 date 的定位 */
const KLINE_COUNT = 120;

/**
 * 计算指定日期（或之前最近交易日）相对前一交易日的涨跌幅%。
 * 找不到前一根（date 早于数据起点）返回 null。
 */
function pctOnOrBefore(kline: { date: string; close: number }[], date: string): number | null {
  if (!kline || kline.length < 2) return null;
  let idx = -1;
  for (let i = 0; i < kline.length; i++) {
    if (kline[i].date <= date) idx = i;
    else break;
  }
  if (idx < 0) idx = 0; // 早于数据起点 → 用最老一根
  if (idx === 0) return null; // 无前一根可对比
  const cur = kline[idx].close;
  const prev = kline[idx - 1].close;
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

async function fetchPct(
  code: string,
  date: string,
): Promise<{ code: string; name: string; pct: number }> {
  const k = await fetchTencentKline(code, KLINE_COUNT, "qfq");
  const pct = pctOnOrBefore(k, date);
  return { code, name: code, pct: pct ?? 0 };
}

/**
 * 构建市场快照。
 * @param date 观点所属交易日 YYYY-MM-DD
 * @param mappings 主题→ETF/指数映射（用于决定抓取哪些相关 ETF）
 */
export async function buildMarketSnapshot(
  date: string,
  mappings: ThemeMapping[],
): Promise<MarketSnapshot> {
  const etfCodes = Array.from(new Set(mappings.flatMap((m) => m.codes)));

  const [indexResults, etfResults] = await Promise.all([
    Promise.all(
      BENCHMARK_INDEXES.map(async (i) => {
        const k = await fetchTencentKline(i.code, KLINE_COUNT, "qfq");
        return { code: i.code, name: i.name, pct: pctOnOrBefore(k, date) ?? 0 };
      }),
    ),
    Promise.all(etfCodes.map((c) => fetchPct(c, date))),
  ]);

  return { date, indexes: indexResults, relatedEtfs: etfResults };
}
