/**
 * 观点回测 · 命中率引擎
 *
 * 对「投资观点」中每条方向信号（buy/sell），取其在观点交易日 T 映射到的代表标的（ETF/指数），
 * 抓取 T ~ T+5 的日 K，计算 T+5 期末收益：
 *   - buy 且收益 > 0 → 命中
 *   - sell 且收益 < 0 → 命中
 *   - hold 计中性，不计入命中率
 *   - 任取数缺口（标的无 T / T+5 数据，或 T+5 尚未发生）→ 标记 gap，排除出统计
 *
 * 数据为「按需计算、不写回」：每次回测实时抓取并聚合，不改变已存记录（避免重复覆盖 / 陈旧）。
 *
 * @module services/insightBacktest
 */

import type { Insight, InvestmentDirection, ThemeMapping } from "@/types";
import { fetchTencentKline } from "@/adapters/datasource/tencentKline";
import { db } from "@/stores/db";
import type { KLineData } from "@/types";

/** 回测取数根数：覆盖足够历史以支持较早 T 的 T+5 定位（≈1.5 年日 K） */
const KLINE_BACK = 400;
/** 回测窗口：观点日 T 之后 N 个交易日（此处按自然日 +5 定位 K 线） */
const HOLD_DAYS = 5;

export interface BacktestFilter {
  /** 起始交易日 YYYY-MM-DD（含） */
  dateFrom?: string;
  /** 截止交易日 YYYY-MM-DD（含） */
  dateTo?: string;
  /** 主题（themeMappings.id）；设置后只统计映射到该主题的 direction */
  theme?: string;
}

export interface BacktestRow {
  insightId: string;
  date: string;
  blogger?: string;
  theme: string;
  direction: InvestmentDirection["direction"];
  brief: string;
  codes: string[];
  /** T+5 区间收益%（多标的取均值；无数据 → null） */
  returnPct: number | null;
  /** 是否命中（买中涨 / 卖中跌）；hold 或缺口 → null */
  hit: boolean | null;
  /** 取数缺口：所有映射标的均无 T~T+5 数据，或 T+5 尚未发生 */
  gap: boolean;
}

export interface ThemeAcc {
  theme: string;
  total: number;
  hits: number;
  /** 命中率%（样本不足 → null） */
  accuracy: number | null;
  /** 平均收益%（样本不足 → null） */
  avgReturn: number | null;
}

export interface DateAcc {
  date: string;
  total: number;
  hits: number;
  accuracy: number | null;
  avgReturn: number | null;
}

export interface CurvePoint {
  date: string;
  /** 截至该日的累计收益%（等权复利，每交易日一步） */
  cumReturn: number;
}

export interface BacktestResult {
  rows: BacktestRow[];
  /** 扫描到的全部信号（买+卖+持有） */
  total: number;
  /** 有效信号（买/卖 且有数据） */
  evaluated: number;
  hits: number;
  /** 命中率%（evaluated=0 → null） */
  accuracy: number | null;
  /** 平均收益%（evaluated=0 → null） */
  avgReturn: number | null;
  byTheme: ThemeAcc[];
  byDate: DateAcc[];
  curve: CurvePoint[];
  /** 取数缺口信号数（买/卖 中无法取到 T~T+5 数据） */
  gaps: number;
}

// ============= 日期工具 =============

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return fmt(d);
}

// ============= K 线收益计算 =============

/** 取 code 在 [from, to] 闭区间内的首末收盘，算区间收益%；任一缺失 → null */
function intervalReturn(kline: KLineData[] | null, from: string, to: string): number | null {
  if (!kline || kline.length < 2) return null;
  let idxFrom = -1;
  let idxTo = -1;
  for (let i = 0; i < kline.length; i++) {
    const dt = kline[i].date;
    if (idxFrom < 0 && dt >= from) idxFrom = i;
    if (dt >= to) {
      idxTo = i;
      break;
    }
  }
  // 找不到 from（全部晚于 from，即数据起点晚于 T）→ 缺口
  if (idxFrom < 0) return null;
  // 找不到 to（T+5 超出数据，可能尚未发生）→ 缺口
  if (idxTo < 0) return null;
  // 退化：T+5 落在 T 之前同根或数据异常
  if (idxTo < idxFrom) return null;
  const entry = kline[idxFrom].close;
  const exit = kline[idxTo].close;
  if (!entry || !exit) return null;
  return ((exit - entry) / entry) * 100;
}

// ============= 主流程 =============

/**
 * 运行观点回测。
 * @param filter 日期范围 / 主题筛选
 * @returns 完整的回测结果（含逐条、按主题、按日、累计曲线）
 */
export async function runBacktest(filter: BacktestFilter = {}): Promise<BacktestResult> {
  const insights = (await db.insights.toArray()) as Insight[];
  const mappings = (await db.themeMappings.toArray()) as ThemeMapping[];

  // 应用日期范围筛选
  const inRange = (d: string) => {
    if (filter.dateFrom && d < filter.dateFrom) return false;
    if (filter.dateTo && d > filter.dateTo) return false;
    return true;
  };

  // 主题筛选：方向映射到该主题的 codes 视为命中该主题
  const themeMap = filter.theme ? mappings.find((m) => m.id === filter.theme) : undefined;

  // 单 run 内按 code 缓存 K 线，避免重复抓取
  const klineCache = new Map<string, KLineData[] | null>();
  const getKline = async (code: string): Promise<KLineData[] | null> => {
    if (klineCache.has(code)) return klineCache.get(code) ?? null;
    const k = await fetchTencentKline(code, KLINE_BACK, "qfq");
    const safe = k.length ? k : null;
    klineCache.set(code, safe);
    return safe;
  };

  const rows: BacktestRow[] = [];

  for (const ins of insights) {
    if (!inRange(ins.date)) continue;
    for (const d of ins.directions) {
      // 主题筛选：若指定主题，方向须映射到该主题 codes
      if (themeMap && !d.mappedCodes.some((c) => themeMap.codes.includes(c))) continue;

      const rowBase = {
        insightId: ins.id,
        date: ins.date,
        blogger: ins.blogger,
        theme: d.theme,
        direction: d.direction,
        brief: d.brief,
        codes: d.mappedCodes,
      };

      // 持有：中性，不计入命中率
      if (d.direction === "hold") {
        rows.push({ ...rowBase, returnPct: null, hit: null, gap: false });
        continue;
      }

      // 买/卖：取映射标的 T~T+5 收益
      const t = ins.date;
      const t5 = addDays(t, HOLD_DAYS);
      const perCode: number[] = [];
      for (const code of d.mappedCodes) {
        const k = await getKline(code);
        const r = intervalReturn(k, t, t5);
        if (r != null) perCode.push(r);
      }

      if (perCode.length === 0) {
        rows.push({ ...rowBase, returnPct: null, hit: null, gap: true });
        continue;
      }

      const avg = perCode.reduce((a, b) => a + b, 0) / perCode.length;
      const hit = d.direction === "buy" ? avg > 0 : d.direction === "sell" ? avg < 0 : false;
      rows.push({ ...rowBase, returnPct: Number(avg.toFixed(2)), hit, gap: false });
    }
  }

  // ============= 聚合 =============
  const evaluatedRows = rows.filter((r) => r.returnPct != null && r.direction !== "hold");

  const total = rows.length;
  const evaluated = evaluatedRows.length;
  const hits = evaluatedRows.filter((r) => r.hit).length;
  const avgReturn =
    evaluated > 0
      ? Number((evaluatedRows.reduce((a, r) => a + (r.returnPct ?? 0), 0) / evaluated).toFixed(2))
      : null;
  const gaps = rows.filter((r) => r.gap).length;

  // 按主题
  const themeAgg = new Map<string, { total: number; hits: number; sum: number }>();
  for (const r of evaluatedRows) {
    const cur = themeAgg.get(r.theme) ?? { total: 0, hits: 0, sum: 0 };
    cur.total += 1;
    cur.hits += r.hit ? 1 : 0;
    cur.sum += r.returnPct ?? 0;
    themeAgg.set(r.theme, cur);
  }
  const byTheme: ThemeAcc[] = Array.from(themeAgg.entries())
    .map(([theme, v]) => ({
      theme,
      total: v.total,
      hits: v.hits,
      accuracy: v.total > 0 ? Number(((v.hits / v.total) * 100).toFixed(1)) : null,
      avgReturn: v.total > 0 ? Number((v.sum / v.total).toFixed(2)) : null,
    }))
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));

  // 按日（每交易日等权平均收益 → 复利累计）
  const dateAgg = new Map<string, { total: number; hits: number; sum: number }>();
  for (const r of evaluatedRows) {
    const cur = dateAgg.get(r.date) ?? { total: 0, hits: 0, sum: 0 };
    cur.total += 1;
    cur.hits += r.hit ? 1 : 0;
    cur.sum += r.returnPct ?? 0;
    dateAgg.set(r.date, cur);
  }
  const byDate: DateAcc[] = Array.from(dateAgg.entries())
    .map(([date, v]) => ({
      date,
      total: v.total,
      hits: v.hits,
      accuracy: v.total > 0 ? Number(((v.hits / v.total) * 100).toFixed(1)) : null,
      avgReturn: v.total > 0 ? Number((v.sum / v.total).toFixed(2)) : null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // 累计收益曲线（按日等权复利）
  const curve: CurvePoint[] = [];
  let equity = 1;
  for (const d of byDate) {
    const dayReturn = (d.avgReturn ?? 0) / 100;
    equity *= 1 + dayReturn;
    curve.push({ date: d.date, cumReturn: Number(((equity - 1) * 100).toFixed(2)) });
  }

  return {
    rows,
    total,
    evaluated,
    hits,
    accuracy: evaluated > 0 ? Number(((hits / evaluated) * 100).toFixed(1)) : null,
    avgReturn,
    byTheme,
    byDate,
    curve,
    gaps,
  };
}
