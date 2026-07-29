/**
 * Service Worker 后台扫描能力层（SW 安全，无任何 DOM / React / Zustand 依赖）
 *
 * 该模块只会被自定义 Service Worker（src/pwa/sw.ts）及其后台扫描逻辑引用，
 * 绝不会被主应用 bundle 引入。其内所有函数都满足：
 *   - 不访问 window / document / Notification 构造器；
 *   - 不引用 dataSourceService（其场外基金路径走 JSONP <script>，SW 无 DOM）；
 *   - 不直接 import 任何会拉入 DOM 代码的模块（stock-api 等）。
 *
 * 数据获取策略通过「从 IndexedDB quoteCache 读快照 + 可选 Worker 代理刷新」实现，
 * 因此即使页面完全关闭，后台扫描也能拿到「最近一次前台扫描」的净值，可靠触发提醒。
 *
 * @module pwa/scanCapabilities
 */

import type { AppNotification, EtfMapping, FundQuote, KLineData, UserSettings } from "@/types";
import { db } from "@/stores/db";
import { fetchTencentKline } from "@/adapters/datasource/tencentKline";
import { periodToCount } from "@/adapters/datasource/periodConfig";
import type { ScanStrategy } from "@/services/plans/scanCore";

/** SW 噪声闸门持久化状态（跨 SW 唤醒保持；SW 无模块级长生命周期状态） */
interface SwNoiseState {
  /** type:title → 上次通过时间戳(ms) */
  dedup: Record<string, number>;
  /** 最近发送时间戳环形缓冲（用于每分钟频率限制） */
  sends: number[];
}

const SW_META_NOISE_ID = "backgroundScanNoise";

/**
 * 从 quoteCache 读取最近一次前台扫描写入的净值快照。
 * 这是后台扫描「脱离页面」的数据来源（无需 JSONP / DOM）。
 */
export async function readQuoteCache(codes: string[]): Promise<Map<string, FundQuote>> {
  const rows = await db.quoteCache.bulkGet(codes);
  const map = new Map<string, FundQuote>();
  for (const row of rows) {
    if (row && row.quote) map.set(row.code, row.quote);
  }
  return map;
}

/** 将净值快照写回 quoteCache（供下次后台扫描使用） */
async function persistQuoteCache(rows: Array<{ code: string; quote: FundQuote }>): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  await db.quoteCache.bulkPut(rows.map((r) => ({ code: r.code, quote: r.quote, updatedAt: now })));
}

/** 读取用户在设置中配置的 push 代理地址（可选） */
async function getPushProxyUrl(): Promise<string> {
  const settings = await db.settings.get("user-settings");
  return settings?.notifications?.pushProxyUrl?.trim() ?? "";
}

/** 经 Worker 代理拉取最新净值（CORS 安全，best-effort） */
async function fetchFreshQuotes(proxy: string, codes: string[]): Promise<FundQuote[]> {
  const url = `${proxy}${proxy.includes("?") ? "&" : "?"}codes=${encodeURIComponent(codes.join(","))}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const data = (await res.json()) as FundQuote[];
  return Array.isArray(data) ? data : [];
}

/**
 * SW 安全净值获取：优先使用 quoteCache 快照（页面关闭后仍有数据）；
 * 若配置了 push 代理则尝试刷新为最新值并回写缓存，失败时降级到缓存。
 */
export async function fetchQuotesSW(codes: string[]): Promise<FundQuote[]> {
  if (codes.length === 0) return [];
  const cached = await readQuoteCache(codes);

  const proxy = await getPushProxyUrl();
  if (proxy) {
    try {
      const fresh = await fetchFreshQuotes(proxy, codes);
      if (fresh.length > 0) {
        const merged = new Map(cached);
        for (const q of fresh) merged.set(q.code, q);
        await persistQuoteCache(
          codes.map((c) => ({ code: c, quote: merged.get(c)! })).filter((r) => r.quote),
        );
        return fresh;
      }
    } catch {
      // 代理失败 → 使用缓存
    }
  }
  return codes.map((c) => cached.get(c)).filter((q): q is FundQuote => Boolean(q));
}

/**
 * SW 安全 ETF K 线获取：直连腾讯 proxy.finance.qq.com（返回 CORS*），
 * 复用应用内已验证的 fetchTencentKline（纯 fetch，无 DOM）。
 */
export const fetchEtfKLineSW = (code: string, period: string): Promise<KLineData[]> =>
  fetchTencentKline(code, periodToCount(period), "qfq");

/**
 * trend 规则依赖 DOM 绑定的数据源，SW 不提供 → 传 undefined，
 * scanCore 会优雅跳过该规则（不报错、不误触发）。
 */
export const computeTrendScoreSW = undefined;

/** 组合出 SW 用的扫描策略（etfMappings 来自设置） */
export function buildSWStrategy(etfMappings: EtfMapping[]): ScanStrategy {
  return {
    fetchQuotes: fetchQuotesSW,
    fetchEtfKLine: fetchEtfKLineSW,
    computeTrendScore: computeTrendScoreSW,
    etfMappings,
  };
}

/** 判断当前是否处于安静时段（支持跨午夜），与 notify.ts 同构 */
function inQuietHours(start: string, end: string): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return false;
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) return cur >= s && cur <= e;
  return cur >= s || cur <= e; // 跨午夜
}

/**
 * 纯 A 股交易时段判定（SW 安全，无 React / stock-sdk 依赖）。
 * 仅用于噪声闸门的市场状态护栏；与 App 的 marketStatus 口径略有差异（不含节假日），
 * 但作为通知护栏足够稳健，且彻底避免把 stock-sdk 拉入 SW 包。
 */
export function isMarketOpenSW(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // 周末休市
  const mins = now.getHours() * 60 + now.getMinutes();
  const inMorning = mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30;
  const inAfternoon = mins >= 13 * 60 && mins <= 15 * 60;
  return inMorning || inAfternoon;
}

/**
 * SW 噪声闸门：复用 App notify() 的全部规则（类型免打扰 / 市场护栏 / 安静时段 /
 * 去重 / 最小间隔 / 频率限制），但把运行态持久化到 db.swMeta，以跨 SW 唤醒保持。
 *
 * @returns true 表示通过闸门（应发送）；false 表示被噪声控制拦截。
 */
export async function swPassNoiseGate(
  input: { type: AppNotification["type"]; title: string },
  settings: UserSettings,
): Promise<boolean> {
  const noise = settings.notifications.noise;
  // 1) 类型免打扰
  if (noise.typeOptOut.includes(input.type)) return false;
  // 1.5) 市场状态护栏：非交易时段抑制非紧急通知
  if (
    noise.marketStatusGuard &&
    !isMarketOpenSW() &&
    (input.type === "info" || input.type === "success")
  ) {
    return false;
  }
  // 2) 安静时段
  if (inQuietHours(noise.quietHoursStart, noise.quietHoursEnd)) return false;

  const now = Date.now();
  const row = await db.swMeta.get(SW_META_NOISE_ID);
  const state: SwNoiseState = (row?.value as SwNoiseState | undefined) ?? { dedup: {}, sends: [] };

  // 3) 去重
  const key = `${input.type}:${input.title}`;
  const last = state.dedup[key] ?? 0;
  if (now - last < noise.dedupWindowMin * 60_000) return false;
  // 4) 最小间隔
  const lastSend = state.sends.length ? state.sends[state.sends.length - 1] : 0;
  if (lastSend && now - lastSend < noise.minIntervalSec * 1000) return false;
  // 5) 频率限制
  const cutoff = now - 60_000;
  while (state.sends.length && state.sends[0] < cutoff) state.sends.shift();
  if (state.sends.length >= noise.maxPerMinute) return false;

  // 通过 → 更新并持久化运行态
  state.dedup[key] = now;
  state.sends.push(now);
  await db.swMeta.put({ id: SW_META_NOISE_ID, value: state });
  return true;
}
