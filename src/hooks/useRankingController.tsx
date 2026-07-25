import { useEffect, useMemo, useState, useCallback, createContext, useContext } from "react";
import {
  getAllSnapshots,
  captureDailySnapshots,
  getLatestCaptureReport,
  localDateKey,
} from "@/services/backtest/decisionSnapshot";
import type { CaptureReport, ScoreSnapshot } from "@/services/backtest/types";
import { useHoldingsStore } from "@/stores/holdings";
import { useSettingsStore } from "@/stores/settings";
import type { FundHolding } from "@/types";
import { parseToTs } from "@/lib/dataTime";
import { toast } from "@/components/ui/toast";

export type RankingSortKey = "score" | "capital" | "sector" | "rank";
export type RankingTab = "score" | "flow";

export interface RankingController {
  loading: boolean;
  busy: boolean;
  sortBy: RankingSortKey;
  setSortBy: (v: RankingSortKey) => void;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  tab: RankingTab;
  setTab: (v: RankingTab) => void;
  coverage: { total: number; covered: number; missing: number };
  effectiveSort: RankingSortKey;
  hasCapital: boolean;
  hasSector: boolean;
  hasRank: boolean;
  rankingAsOf: number | null;
  ranked: ScoreSnapshot[];
  stats: { total: number; buy: number; hold: number; sell: number; avg: number };
  missingFunds: { code: string; name: string; source: string | null; reason: string }[];
  handleCapture: () => void;
  handleForceRefresh: () => void;
  eastmoneyEnabled: boolean;
  cols: number;
  holdingMap: Map<string, FundHolding>;
}

function useRankingController(): RankingController {
  const [allSnapshots, setAllSnapshots] = useState<ScoreSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState<RankingSortKey>("score");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [tab, setTab] = useState<RankingTab>("score");

  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings);
  const eastmoneyEnabled = useSettingsStore((s) => s.settings.dataSource.eastmoney.enabled);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  const load = useCallback(async () => {
    const [data, rep] = await Promise.all([getAllSnapshots(), getLatestCaptureReport()]);
    setAllSnapshots(data);
    setReport(rep);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHoldings();
    loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setLoading(false));
  }, [loadHoldings, loadSettings, load]);

  // 每只基金取最新一次快照
  const latestByFund = useMemo(() => {
    const map = new Map<string, ScoreSnapshot>();
    for (const s of allSnapshots) {
      const existing = map.get(s.fundCode);
      if (!existing || s.date > existing.date) map.set(s.fundCode, s);
    }
    return Array.from(map.values());
  }, [allSnapshots]);

  const holdingMap = useMemo(() => {
    const m = new Map<string, FundHolding>();
    for (const h of holdings) m.set(h.code, h);
    return m;
  }, [holdings]);

  // 今日缓存覆盖：已评 / 总数 / 缺失（与 captureDailySnapshots 的缓存跳过逻辑联动）
  const todayKey = localDateKey();
  const coverage = useMemo(() => {
    const todayCovered = new Set(
      allSnapshots.filter((s) => s.date === todayKey).map((s) => s.fundCode),
    );
    const total = holdings.length;
    const covered = holdings.filter((h) => todayCovered.has(h.code)).length;
    return { total, covered, missing: Math.max(0, total - covered) };
  }, [allSnapshots, holdings, todayKey]);

  // 维度可用性仅取决于数据本身（与排序无关），用 latestByFund 避免与 ranked 形成依赖环
  const hasCapital = latestByFund.some((s) => s.capitalScore != null);
  const hasSector = latestByFund.some((s) => s.sectorScore != null);
  const hasRank = latestByFund.some((s) => s.rankPercentile != null);

  // 评分快照数据时间：取各基金最新快照 date 的最大值（接口数据对应的日期）
  const rankingAsOf = useMemo(() => {
    let max: number | null = null;
    for (const s of latestByFund) {
      const ts = parseToTs(s.date);
      if (ts != null && (max == null || ts > max)) max = ts;
    }
    return max;
  }, [latestByFund]);

  // 选中维度若已无数据（如东财关闭 / 快照被清空），effectiveSort 自动回退到综合评分，
  // 既保证“无数据维度无法被选中”，也避免按钮同时呈现“选中 + 禁用”的冲突态。
  const effectiveSort: RankingSortKey =
    sortBy === "capital" && !hasCapital
      ? "score"
      : sortBy === "sector" && !hasSector
        ? "score"
        : sortBy === "rank" && !hasRank
          ? "score"
          : sortBy;

  // 排序：综合评分降序（买入红在前），资金面分作 tie-break；
  // 切换为「资金面分」时，以 capitalScore 为主、score 为辅（null 沉底）；
  // 切换为「赛道分」时，以 sectorScore 为主、score 为辅（null 沉底）。
  const ranked = useMemo(() => {
    const arr = [...latestByFund];
    if (effectiveSort === "capital") {
      return arr.sort((a, b) => {
        const ca = a.capitalScore ?? -Infinity;
        const cb = b.capitalScore ?? -Infinity;
        if (cb !== ca) return cb - ca;
        return b.score - a.score;
      });
    }
    if (effectiveSort === "sector") {
      return arr.sort((a, b) => {
        const sa = a.sectorScore ?? -Infinity;
        const sb = b.sectorScore ?? -Infinity;
        if (sb !== sa) return sb - sa;
        return b.score - a.score;
      });
    }
    if (effectiveSort === "rank") {
      // 同类排名百分位越小越好 → 升序，null 沉底；同值以综合评分为辅
      return arr.sort((a, b) => {
        const ra = a.rankPercentile ?? Infinity;
        const rb = b.rankPercentile ?? Infinity;
        if (ra !== rb) return ra - rb;
        return b.score - a.score;
      });
    }
    return arr.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ca = a.capitalScore ?? -Infinity;
      const cb = b.capitalScore ?? -Infinity;
      return cb - ca;
    });
  }, [latestByFund, effectiveSort]);

  const stats = useMemo(() => {
    let buy = 0;
    let hold = 0;
    let sell = 0;
    let scoreSum = 0;
    for (const s of ranked) {
      if (s.recommendation === "buy") buy++;
      else if (s.recommendation === "hold") hold++;
      else sell++;
      scoreSum += s.score;
    }
    return {
      total: ranked.length,
      buy,
      hold,
      sell,
      avg: ranked.length ? Math.round(scoreSum / ranked.length) : 0,
    };
  }, [ranked]);

  // 未纳入评分的持仓：无快照 → 可能数据源不可达（东财净值 / 腾讯ETF K线）或尚未采集
  const missingFunds = useMemo(() => {
    const covered = new Set(latestByFund.map((s) => s.fundCode));
    const failuresByCode = new Map((report?.failures ?? []).map((f) => [f.code, f]));
    return holdings
      .filter((h) => !covered.has(h.code))
      .map((h) => {
        const f = failuresByCode.get(h.code);
        return {
          code: h.code,
          name: h.name || h.code,
          source: f?.source ?? null,
          reason: f?.reason ?? "今日尚未采集，点上方「更新今日评分」补评",
        };
      });
  }, [holdings, latestByFund, report]);

  // 与缓存联动：仅补评当日缺失的持仓，已存在的直接跳过
  const handleCapture = useCallback(async () => {
    setBusy(true);
    try {
      const n = await captureDailySnapshots({ force: true });
      await load();
      if (n > 0) toast({ type: "success", message: `已更新 ${n} 只今日评分（含增强维度回填）` });
      else toast({ type: "info", message: "今日评分已全部就绪" });
    } catch {
      toast({ type: "error", message: "采集失败" });
    }
    setBusy(false);
  }, [load]);

  // 强制重评：忽略缓存，覆盖全部持仓今日快照（需二次确认，避免无谓请求）
  const handleForceRefresh = useCallback(async () => {
    if (busy) return;
    const ok = window.confirm("将重新拉取全部持仓今日评分并覆盖已有结果，确认？");
    if (!ok) return;
    setBusy(true);
    try {
      const n = await captureDailySnapshots({ force: true, reevaluate: true });
      await load();
      toast({ type: "success", message: `已重评 ${n} 只今日评分` });
    } catch {
      toast({ type: "error", message: "采集失败" });
    }
    setBusy(false);
  }, [busy, load]);

  const cols = 7 + (hasCapital ? 1 : 0) + (hasSector ? 1 : 0) + (hasRank ? 1 : 0);

  return {
    loading,
    busy,
    sortBy,
    setSortBy,
    expanded,
    setExpanded,
    tab,
    setTab,
    coverage,
    effectiveSort,
    hasCapital,
    hasSector,
    hasRank,
    rankingAsOf,
    ranked,
    stats,
    missingFunds,
    handleCapture,
    handleForceRefresh,
    eastmoneyEnabled,
    cols,
    holdingMap,
  };
}

const RankingContext = createContext<RankingController | null>(null);

export function RankingProvider({ children }: { children: React.ReactNode }) {
  const controller = useRankingController();
  return <RankingContext.Provider value={controller}>{children}</RankingContext.Provider>;
}

export function useRanking(): RankingController {
  const ctx = useContext(RankingContext);
  if (!ctx) throw new Error("useRanking 必须在 <RankingProvider> 内使用");
  return ctx;
}
