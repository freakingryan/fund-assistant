/**
 * ETF 期权数据层（新浪自实现）
 *
 * 覆盖：品种 / 到期月 / T 型链（calls+puts×行权价）/ 合约行情。
 * 希腊字母与隐含波动率（IV）不在此层，由 src/lib/optionPricing.ts 纯前端计算（C2 面板调用）。
 *
 * 数据源：新浪（hq.sinajs.cn / stock.finance.sina.com.cn），非东财 / 腾讯，符合「不自写东财/腾讯解析」原则。
 * 走共享 Cloudflare Worker 反代（与同花顺/巨潮同通道），浏览器无法自带 Referer，由 Worker 注入。
 *
 * 门控：开启「设置 → 数据源 → 增强数据源（同花顺/巨潮）」且东财增强配置 proxy 模式。
 *   —— 与同花顺/巨潮共用同一个 Worker 反代与 proxy 配置载体（EastmoneyDataSourceConfig）。
 *
 * @module etfOptions
 */

import type { EastmoneyDataSourceConfig } from "@/types";
import { buildProxyFetch } from "./proxyFetch";
import { useSettingsStore } from "@/stores/settings";

/** 门控失败：未开启增强数据源或未配置 Worker 反代 */
export class EtfOptionDisabledError extends Error {
  constructor() {
    super(
      "ETF 期权行情需开启「设置 → 数据源 → 增强数据源（同花顺/巨潮）」并在东财增强中配置 Cloudflare Worker 反代",
    );
    this.name = "EtfOptionDisabledError";
  }
}

/** 主流 ETF 期权标的（代码稳定，自实现可控；新浪各标的不提供统一列表接口） */
export const ETF_OPTION_UNDERLYINGS: { name: string; code: string }[] = [
  { name: "50ETF", code: "510050" },
  { name: "300ETF", code: "510300" },
  { name: "500ETF", code: "510500" },
  { name: "科创50", code: "588000" },
  { name: "科创板50", code: "588080" },
];

export type EtfOptionSide = "call" | "put";

/** 单个期权合约行情（源自新浪 CON_OP 实时行情，GBK 解码） */
export interface EtfOptionContract {
  /** 合约代码，如 CON_OP_10011255 */
  code: string;
  side: EtfOptionSide;
  /** 标的 ETF 代码，如 510050 */
  underlyingCode: string;
  /** 合约名称（GBK，含「购/沽」） */
  name: string;
  /** 行权价 */
  strike: number;
  /** 到期日 YYYY-MM-DD */
  expireDate: string;
  /** 剩余自然日 */
  daysLeft: number;
  /** 最新价 */
  last: number;
  /** 涨跌幅 % */
  changePct: number;
  /** 买一价 */
  bid: number;
  /** 卖一价 */
  ask: number;
  /** 持仓量（手） */
  openInterest: number;
  /** 成交量（手） */
  volume: number;
}

/** T 型链一行：同一行权价下的认购 / 认沽合约 */
export interface EtfOptionChainRow {
  strike: number;
  call?: EtfOptionContract;
  put?: EtfOptionContract;
}

const GET_STOCK_NAME_URL =
  "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName";

/** 读取并校验门控配置（复用 extraSources 开关 + eastmoney 的 proxy 载体） */
function requireSinaConfig(): EastmoneyDataSourceConfig {
  const ds = useSettingsStore.getState().settings.dataSource;
  if (!ds.extraSources.enabled) throw new EtfOptionDisabledError();
  const em = ds.eastmoney;
  if (em.mode !== "proxy" || !em.proxyUrl) throw new EtfOptionDisabledError();
  return em;
}

/** 经共享 Worker 反代发起请求（命中 PROXY_HOST_RE 时改写 host + 注入 x-upstream-host） */
function sinaFetch(config: EastmoneyDataSourceConfig): typeof fetch {
  return buildProxyFetch(config);
}

/** 取 UTF-8 JSON（新浪 openapi 走 UTF-8） */
async function sinaJson(config: EastmoneyDataSourceConfig, url: string): Promise<unknown> {
  const fetchImpl = sinaFetch(config);
  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`新浪期权请求失败: ${resp.status}`);
  return resp.json();
}

/** 取 GBK 文本（hq.sinajs.cn 行情为 GBK 编码，需本地解码；Referer 由 Worker 注入） */
async function sinaTextGbk(config: EastmoneyDataSourceConfig, url: string): Promise<string> {
  const fetchImpl = sinaFetch(config);
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`新浪期权行情请求失败: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new TextDecoder("gbk").decode(buf);
}

/** 从 OP_UP/OP_DOWN 列表文本提取 CON_OP 合约代码串 */
function parseContractCodeList(text: string): string[] {
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 解析 CON_OP 批量行情文本。
 * 字段布局（逗号分隔，0-indexed，已实测）：
 *   1=买一价 2=最新价 3=卖一价 5=持仓量 6=涨跌幅% 7=行权价
 *   36=标的 37=名称(GBK) 41=成交量 45=C/P 46=到期日 47=剩余天数
 */
function parseContractQuotes(text: string): EtfOptionContract[] {
  const out: EtfOptionContract[] = [];
  const re = /var hq_str_(CON_OP_\d+)="([^"]*)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) {
    const code = mm[1];
    const f = mm[2].split(",");
    const num = (i: number): number => {
      const v = Number(f[i]);
      return Number.isFinite(v) ? v : NaN;
    };
    const sideChar = (f[45] ?? "").trim().toUpperCase();
    const side: EtfOptionSide = sideChar === "P" ? "put" : "call";
    out.push({
      code,
      side,
      underlyingCode: (f[36] ?? "").trim(),
      name: (f[37] ?? "").trim(),
      strike: num(7),
      expireDate: (f[46] ?? "").trim(),
      daysLeft: num(47),
      last: num(2),
      changePct: num(6),
      bid: num(1),
      ask: num(3),
      openInterest: num(5),
      volume: num(41),
    });
  }
  return out;
}

/** 批量拉取合约行情（一次最多 50 个，避免 URL 过长） */
async function fetchBatchQuotes(
  config: EastmoneyDataSourceConfig,
  codes: string[],
): Promise<EtfOptionContract[]> {
  const out: EtfOptionContract[] = [];
  const CHUNK = 50;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const batch = codes.slice(i, i + CHUNK);
    const text = await sinaTextGbk(config, `https://hq.sinajs.cn/list=${batch.join(",")}`);
    out.push(...parseContractQuotes(text));
  }
  return out;
}

/**
 * 可取到期月列表（所有标的一致：当月 / 次月 / 随后两个季月）。
 * 取自上交所 50ETF 默认标的的 contractMonth，去重排序。
 */
export async function fetchEtfOptionMonths(_code = "510050"): Promise<string[]> {
  const config = requireSinaConfig();
  const json = (await sinaJson(config, GET_STOCK_NAME_URL)) as {
    result?: { data?: { contractMonth?: string[] } };
  };
  const months = json.result?.data?.contractMonth ?? [];
  return Array.from(new Set(months)).sort();
}

/**
 * 取某标的某到期月的 T 型链（按行权价聚合 call/put）。
 * @param code 标的 ETF 代码，如 510050
 * @param month 到期月，如 "2026-08"
 */
export async function fetchEtfOptionChain(
  code: string,
  month: string,
): Promise<EtfOptionChainRow[]> {
  const config = requireSinaConfig();
  const yymm = month.replace("-", "").slice(2); // "2026-08" -> "2608"
  const [upText, downText] = await Promise.all([
    sinaTextGbk(config, `https://hq.sinajs.cn/list=OP_UP_${code}${yymm}`),
    sinaTextGbk(config, `https://hq.sinajs.cn/list=OP_DOWN_${code}${yymm}`),
  ]);
  const codes = [...parseContractCodeList(upText), ...parseContractCodeList(downText)];
  if (codes.length === 0) return [];

  const quotes = await fetchBatchQuotes(config, codes);
  const byStrike = new Map<number, EtfOptionChainRow>();
  for (const q of quotes) {
    if (!Number.isFinite(q.strike)) continue;
    const row = byStrike.get(q.strike) ?? { strike: q.strike };
    if (q.side === "call") row.call = q;
    else row.put = q;
    byStrike.set(q.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}
