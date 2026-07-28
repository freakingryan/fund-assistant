/**
 * 组合风险分析（纯本地计算，无需外部增强）
 *
 * 基于各持仓的「近一年净值序列」计算三类风险指标：
 *   1. 相关性矩阵：持仓两两日收益率的 Pearson 相关系数（-1 分散 ~ +1 集中）。
 *   2. 行业集中度：按当前市值加权各持仓的「行业(sector)」权重，HHI 指数 + 头部行业权重。
 *   3. 组合最大回撤：以当前权重构造组合收益序列，计算其净值指数的最大回撤。
 *
 * 数据来自 dataSourceService.fetchKLine(code, '1y')（close === 净值），经 klineCache 缓存；
 * 东财不可达时 fetchKLine 降级为空数组，对应持仓自动跳过（UI 标注覆盖度）。
 *
 * @module portfolioRisk
 */

import type { FundHolding } from "@/types";
import { dataSourceService } from "@/adapters/datasource/service";
import { getKlineCache, setKlineCache } from "@/services/klineCache";
import { calcValue } from "@/lib/format";

const PERIOD = "1y";
const MIN_POINTS = 20; // 相关性计算所需的最小共同样本点
const FETCH_CONCURRENCY = 4;

interface NavSeries {
  code: string;
  name: string | null;
  dates: string[];
  navs: number[];
}

/** 取单只基金近一年净值序列（优先缓存） */
async function fetchNavSeries(code: string): Promise<NavSeries | null> {
  const cached = await getKlineCache(code, PERIOD);
  let kline = cached && cached.length ? cached : null;
  if (!kline) {
    kline = await dataSourceService.fetchKLine(code, PERIOD);
    if (kline && kline.length) await setKlineCache(code, PERIOD, kline);
  }
  if (!kline || kline.length === 0) return null;

  const dates: string[] = [];
  const navs: number[] = [];
  for (const p of kline) {
    const nav = p.close;
    if (nav == null) continue;
    dates.push(p.date);
    navs.push(nav);
  }
  return dates.length >= 2 ? { code, name: null, dates, navs } : null;
}

/** 净值序列 → 日收益率 Map（date → r） */
function toReturns(dates: string[], navs: number[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1];
    if (prev === 0) continue;
    m.set(dates[i], navs[i] / prev - 1);
  }
  return m;
}

function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length;
}

/** Pearson 相关系数 */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

/** 受限并发 map */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface CorrelationResult {
  /** 持仓代码（用作 key / tooltip） */
  codes: string[];
  /** 展示用短标签（名称前 6 字或代码） */
  labels: string[];
  /** 相关系数矩阵，值 ∈ [-1, 1]，NaN 表示样本不足 */
  matrix: number[][];
}

export interface PortfolioRiskResult {
  fetchedAt: number;
  /** 持仓总数 */
  holdingsCount: number;
  /** 成功取到净值的持仓数 */
  withNav: number;
  /** 组合最大回撤(%)，负值；无数据为 null */
  maxDrawdown: number | null;
  /** 行业集中度 HHI（0-100 标度），无数据为 null */
  sectorHHI: number | null;
  /** 头部行业（权重最大）及其权重(%）；无数据为 null */
  topSector: { name: string; weight: number } | null;
  /** 行业数量 */
  sectorCount: number;
  /** 相关性矩阵；持仓 < 2 或样本不足时为 null */
  correlation: CorrelationResult | null;
}

/**
 * 计算组合风险指标。
 * 集中度用全部持仓的当前市值加权；相关性 / 回撤仅用取到净值的持仓。
 */
export async function computePortfolioRisk(holdings: FundHolding[]): Promise<PortfolioRiskResult> {
  const total = holdings.length;

  const seriesList = await mapLimit(holdings, FETCH_CONCURRENCY, async (h) => {
    const nav = await fetchNavSeries(h.code);
    if (!nav) return null;
    return {
      code: h.code,
      name: h.name || null,
      returns: toReturns(nav.dates, nav.navs),
    };
  });
  const valid = seriesList.filter((s): s is NonNullable<typeof s> => s !== null);
  const withNav = valid.length;

  // —— 行业集中度（全部持仓，当前市值加权）——
  const totalValue = holdings.reduce((s, h) => s + calcValue(h), 0);
  let sectorHHI: number | null = null;
  let topSector: { name: string; weight: number } | null = null;
  let sectorCount = 0;
  if (totalValue > 0) {
    const sectorW = new Map<string, number>();
    for (const h of holdings) {
      const w = calcValue(h) / totalValue;
      sectorW.set(h.sector, (sectorW.get(h.sector) || 0) + w);
    }
    sectorCount = sectorW.size;
    let hhi = 0;
    for (const w of sectorW.values()) hhi += w * w;
    sectorHHI = Math.round(hhi * 100 * 100) / 100; // 0-100 标度
    let topW = -1;
    let topName = "";
    for (const [sec, w] of sectorW.entries()) {
      if (w > topW) {
        topW = w;
        topName = sec;
      }
    }
    if (topW >= 0) {
      topSector = { name: topName, weight: Math.round(topW * 1000) / 10 }; // %
    }
  }

  // —— 相关性矩阵 ——
  let correlation: CorrelationResult | null = null;
  if (valid.length >= 2) {
    const codes = valid.map((s) => s.code);
    const labels = valid.map((s) => (s.name ? s.name.slice(0, 6) : s.code));
    const matrix: number[][] = valid.map((si, i) =>
      valid.map((sj, j) => {
        if (i === j) return 1;
        // 取较小集合遍历，与较大集合求交集，降低开销
        const [small, large] =
          si.returns.size <= sj.returns.size ? [si.returns, sj.returns] : [sj.returns, si.returns];
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [d, rv] of small.entries()) {
          const ov = large.get(d);
          if (ov !== undefined) {
            xs.push(rv);
            ys.push(ov);
          }
        }
        if (xs.length < MIN_POINTS) return NaN;
        return pearson(xs, ys);
      }),
    );
    correlation = { codes, labels, matrix };
  }

  // —— 组合最大回撤（当前权重构造组合收益指数）——
  let maxDrawdown: number | null = null;
  if (valid.length >= 1) {
    const rawW = new Map<string, number>();
    let wsum = 0;
    for (const s of valid) {
      const h = holdings.find((x) => x.code === s.code);
      const w = h ? calcValue(h) : 0;
      rawW.set(s.code, w);
      wsum += w;
    }
    const wmap = new Map<string, number>();
    if (wsum > 0) {
      for (const [c, w] of rawW) wmap.set(c, w / wsum);
    }

    const dateSet = new Set<string>();
    for (const s of valid) for (const d of s.returns.keys()) dateSet.add(d);
    const dates = Array.from(dateSet).sort();

    let index = 1;
    let peak = 1;
    let mdd = 0;
    for (const d of dates) {
      let pr = 0;
      for (const s of valid) {
        const w = wmap.get(s.code) || 0;
        const r = s.returns.get(d);
        if (r !== undefined) pr += w * r;
      }
      index *= 1 + pr;
      if (index > peak) peak = index;
      const dd = index / peak - 1;
      if (dd < mdd) mdd = dd;
    }
    maxDrawdown = Math.round(mdd * 10000) / 100; // %
  }

  return {
    fetchedAt: Date.now(),
    holdingsCount: total,
    withNav,
    maxDrawdown,
    sectorHHI,
    topSector,
    sectorCount,
    correlation,
  };
}
