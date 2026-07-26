/**
 * 同花顺数据源（fund-assistant 自实现）
 *
 * 覆盖：一致预期EPS（worth.html / GBK / 依赖无关表格抽取）、人气热榜、题材归因。
 * 这些端点无第三方库覆盖，按用户原则自实现（非东财/腾讯，不违反「不写东财/腾讯解析」）。
 *
 * 所有请求经共享 Worker 反代（buildProxyFetch）；同花顺需注入 User-Agent / Referer。
 *
 * @module extraSources/tonghuashun
 */

import type {
  EastmoneyDataSourceConfig,
  ThemeItem,
  TonghuashunEps,
  TonghuashunHotItem,
} from "@/types";
import { buildProxyFetch } from "../proxyFetch";

const THS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";

/** 构造带同花顺 UA/Referer 的 fetch（经共享反代） */
function thsFetch(config: EastmoneyDataSourceConfig, referer: string): typeof fetch {
  const base = buildProxyFetch(config);
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", THS_UA);
    if (!headers.has("Referer")) headers.set("Referer", referer);
    return base(input, { ...init, headers });
  };
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 从一段 HTML 抽取所有 <td> 文本（去标签 + 去首尾空白） */
function extractCells(rowHtml: string): string[] {
  const cells = rowHtml.split(/<td[^>]*>/i).slice(1);
  return cells.map((c) => {
    const text = c.replace(/<\/td>[\s\S]*$/, "").replace(/<[^>]+>/g, "");
    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  });
}

/**
 * 解析一致预期EPS 表格。worth.html 含多个表，定位含「每股收益」字样的表，
 * 取其中年度行（首格为 4 位年份、后续为数值列）。
 */
function parseEpsTable(html: string): TonghuashunEps[] {
  const tables = html.split(/<table[^>]*>/i).slice(1);
  for (const seg of tables) {
    if (!/每股收益|预测每股收益|机构预测/.test(seg)) continue;
    const rows = seg.split(/<tr[^>]*>/i).slice(1);
    const out: TonghuashunEps[] = [];
    for (const row of rows) {
      const cells = extractCells(row);
      if (cells.length < 5) continue;
      const year = (cells[0].match(/\d{4}/) ?? [])[0];
      if (!year) continue;
      const nums = cells.slice(1, 5).map(toNumOrNull);
      if (nums.every((n) => n === null)) continue;
      out.push({
        year,
        agencyCount: nums[0],
        min: nums[1],
        avg: nums[2],
        max: nums[3],
      });
    }
    if (out.length > 0) return out;
  }
  return [];
}

/**
 * 同花顺一致预期EPS。
 * @param code 6 位股票代码
 */
export async function getConsensusEps(
  code: string,
  config: EastmoneyDataSourceConfig,
): Promise<TonghuashunEps[]> {
  const url = `https://basic.10jqka.com.cn/new/${code}/worth.html`;
  const fetchImpl = thsFetch(config, "https://basic.10jqka.com.cn/");
  const resp = await fetchImpl(url, { headers: { Accept: "text/html" } });
  if (!resp.ok) throw new Error(`同花顺一致预期EPS请求失败: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const html = new TextDecoder("gbk").decode(buf);
  return parseEpsTable(html);
}

/**
 * 同花顺人气热榜。
 * @param period hour=分时热榜 / day=日热榜
 */
export async function getHotList(
  config: EastmoneyDataSourceConfig,
  period: "hour" | "day" = "hour",
): Promise<TonghuashunHotItem[]> {
  const url = `https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=${period}&list_type=normal`;
  const fetchImpl = thsFetch(config, "https://dq.10jqka.com.cn/");
  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`同花顺热榜请求失败: ${resp.status}`);
  const json = (await resp.json()) as { data?: { stock_list?: Record<string, unknown>[] } };
  const list = json.data?.stock_list ?? [];
  return list.map((it) => ({
    rank: toNumOrNull(it.rank) ?? 0,
    code: String(it.code ?? ""),
    name: String(it.name ?? ""),
    heat: toNumOrNull(it.heat) ?? 0,
    pct: toNumOrNull(it.pct),
    rankChg: toNumOrNull(it.rank_chg ?? it.rankChg),
    concepts: Array.isArray(it.concepts) ? it.concepts.map(String) : [],
    tag: it.tag ? String(it.tag) : undefined,
  }));
}

/**
 * 同花顺题材归因（当日涨停个股的题材标签）。
 * @param date YYYY-MM-DD
 */
export async function getThemeAttribution(
  config: EastmoneyDataSourceConfig,
  date: string,
): Promise<ThemeItem[]> {
  const url = `http://zx.10jqka.com.cn/event/api/getharden/date/${date}/orderby/date/orderway/desc/charset/GBK/`;
  const fetchImpl = thsFetch(config, "https://zx.10jqka.com.cn/");
  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`同花顺题材归因请求失败: ${resp.status}`);
  const json = (await resp.json()) as { data?: Array<Record<string, unknown>> };
  const data = json.data ?? [];
  return data
    .map((it) => ({
      code: String(it.code ?? it.stock_code ?? ""),
      name: String(it.name ?? ""),
      reason: String(it.reason ?? it.harden_reason ?? ""),
    }))
    .filter((it) => it.code);
}
