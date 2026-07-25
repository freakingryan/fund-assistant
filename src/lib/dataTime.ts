/**
 * 数据时间解析与格式化
 *
 * 统一「接口数据对应的时间」展示逻辑：
 *  - 优先使用接口返回的数据内嵌时间（如 K 线末根 date / 净值 navDate / 持仓报告期 date）；
 *  - 若接口未返回时间，则回退到「调用接口的时间」（fetch / 缓存写入时间）。
 *
 * 时区：所有展示按北京时间（Asia/Shanghai）格式化为 YYYY-MM-DD HH:mm，
 * 避免 date-only 字符串被当成 UTC 解析而偏移一天。
 */

const CN_TZ = "Asia/Shanghai";

/** 将任意时间表达（ms 数字 / 日期字符串 / date-only 字符串）解析为毫秒时间戳；无法解析返回 null */
export function parseToTs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const s = value.trim();
  if (!s) return null;
  // date-only：YYYY-MM-DD → 按北京时间零点解析（避免 new Date 当成 UTC 偏移一天）
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const y = +m[1];
    const mo = +m[2] - 1;
    const d = +m[3];
    return Date.UTC(y, mo, d) - 8 * 3600 * 1000;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * 解析数据「对应的时间」：优先接口内嵌时间，否则回退调用时间。
 */
export function resolveAsOf(
  apiTime: string | number | null | undefined,
  fetchedAt?: number | null,
): number | null {
  const api = parseToTs(apiTime);
  if (api != null) return api;
  return fetchedAt ?? null;
}

/** 从 K 线序列派生数据时间：取最后一根的 date（最新数据点） */
export function asOfFromKlines(klines?: { date: string }[] | null): number | null {
  if (!klines || klines.length === 0) return null;
  return parseToTs(klines[klines.length - 1].date);
}

/** 从行情列表派生数据时间：取最小的 navDate（批量数据的最早边界，最保守下界） */
export function asOfFromQuotes(quotes?: { navDate?: string }[] | null): number | null {
  if (!quotes || quotes.length === 0) return null;
  let min: number | null = null;
  for (const q of quotes) {
    if (!q.navDate) continue;
    const ts = parseToTs(q.navDate);
    if (ts == null) continue;
    if (min == null || ts < min) min = ts;
  }
  return min;
}

/** 从持仓明细派生数据时间：报告期 date */
export function asOfFromPortfolio(pf?: { date: string } | null): number | null {
  if (!pf || !pf.date) return null;
  return parseToTs(pf.date);
}

// ── 格式化（统一北京时间 YYYY-MM-DD HH:mm） ───────────────

function fmtParts(ts: number): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return dtf.formatToParts(new Date(ts)).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
}

const pad = (n: string) => n;

/** 2026-07-25 */
export function formatDateOnly(ts: number | null | undefined): string {
  if (ts == null || Number.isNaN(ts)) return "";
  const p = fmtParts(ts);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 2026-07-25 15:30 */
export function formatDateTime(ts: number | null | undefined): string {
  if (ts == null || Number.isNaN(ts)) return "";
  const p = fmtParts(ts);
  return `${p.year}-${p.month}-${p.day} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 15:30 */
export function formatTimeOnly(ts: number | null | undefined): string {
  if (ts == null || Number.isNaN(ts)) return "";
  const p = fmtParts(ts);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
