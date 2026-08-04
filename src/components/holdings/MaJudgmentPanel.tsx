/**
 * 均线研判面板
 *
 * 基于 20/60/120/250 日线，对「场内 ETF / 个股 / 基金净值」给出买卖研判：
 * 站稳 X 日线建议加仓/入场，跌破 X 日线建议止盈/减仓/清仓。
 *
 * 三种数据源（优先级 etfCode > code > navCode）：
 *  - etfCode：基金关联的内场 ETF/指数代码，走 fetchEtfKLine（真实 K 线）
 *  - code   ：个股/ETF 代码（StockDetailPage），走 fetchStockKLine（真实 K 线）
 *  - navCode：基金净值代码（fund.code），走 fetchKLine（单位净值序列，均线只看收盘价）
 *
 * 数据：面板自带拉取 1y 日线（约 250 根），确保 250 日线可计算，
 * 不受图表当前周期（默认 3m=66 根）影响。缓存 key 按数据源隔离。
 *
 * @module MaJudgmentPanel
 */

import { useEffect, useState, useMemo } from "react";
import type { KLineData } from "@/types";
import { dataSourceService } from "@/adapters/datasource/service";
import { getKlineCache, setKlineCache, getKlineCacheTime } from "@/services/klineCache";
import { judgeMaLines, CONFIRM_DAYS, type MaJudgment, type MaPosture } from "@/services/maJudgment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Info } from "lucide-react";

interface Props {
  /** 个股/ETF 代码（StockDetailPage），走 fetchStockKLine */
  code?: string;
  /** 场内 ETF/指数代码（基金关联），走 fetchEtfKLine，优先于 code */
  etfCode?: string;
  /** 基金净值代码（fund.code），走 fetchKLine（净值序列），作为兜底 */
  navCode?: string;
}

type Mode = "etf" | "stock" | "nav";

const POSTURE_META: Record<MaPosture, { label: string; tone: string; dot: string }> = {
  strong_bull: { label: "强多", tone: "text-up", dot: "bg-up" },
  bull: { label: "偏多", tone: "text-up", dot: "bg-up" },
  neutral: { label: "震荡", tone: "text-foreground", dot: "bg-muted-foreground" },
  bear: { label: "偏空", tone: "text-down", dot: "bg-down" },
  strong_bear: { label: "强空", tone: "text-down", dot: "bg-down" },
  insufficient: { label: "数据不足", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

function statusTone(j: MaJudgment): string {
  if (j.direction === "up") return "text-up";
  if (j.direction === "down") return "text-down";
  return "text-foreground";
}

function StatusBadge({ j }: { j: MaJudgment }) {
  const tone = statusTone(j);
  const bg =
    j.status === "hold"
      ? "bg-up/10 border-up/30"
      : j.status === "break"
        ? "bg-down/10 border-down/30"
        : j.status === "above_unconfirmed" || j.status === "below_unconfirmed"
          ? "bg-amber-500/10 border-amber-500/30"
          : j.status === "insufficient"
            ? "bg-muted/40 border-border/40"
            : "bg-muted/30 border-border/40";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${bg} ${tone}`}
    >
      {j.statusLabel}
    </span>
  );
}

export function MaJudgmentPanel({ code, etfCode, navCode }: Props) {
  const [klines, setKlines] = useState<KLineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const mode: Mode | null = etfCode ? "etf" : code ? "stock" : navCode ? "nav" : null;
  const target = etfCode || code || navCode || "";
  const usingNav = mode === "nav";

  useEffect(() => {
    if (!mode || !target) return;
    let cancelled = false;
    const cacheKey = `maj_${mode}_${target}`;
    setLoading(true);

    const load = async () => {
      const cached = await getKlineCache(cacheKey, "1y");
      if (!cancelled && cached?.length) {
        setKlines(cached);
        setLoading(false);
        getKlineCacheTime(cacheKey, "1y").then((ts) => ts && setFetchedAt(ts));
        return;
      }
      // 1y 窗口（约 250 根日线）足以支撑 250 日线
      const data =
        mode === "etf"
          ? await dataSourceService.fetchEtfKLine(target, "1y")
          : mode === "stock"
            ? await dataSourceService.fetchStockKLine(target, "1y")
            : await dataSourceService.fetchKLine(target, "1y");
      if (!cancelled) {
        if (data.length > 0) {
          await setKlineCache(cacheKey, "1y", data);
          setFetchedAt(Date.now());
        }
        setKlines(data);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [mode, target]);

  const result = useMemo(() => judgeMaLines(klines), [klines]);

  if (!mode || !target) return null;

  const title = usingNav ? "净值均线研判" : "均线研判";
  const subtitle = usingNav ? "净值 20/60/120/250 日均线" : "20/60/120/250 日线";

  if (loading && klines.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">加载日线中…</p>
        </CardContent>
      </Card>
    );
  }

  if (klines.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {usingNav ? "暂无净值日线数据" : "暂无 K 线数据"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const meta = POSTURE_META[result.posture];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          {title}
          <span className="text-[10px] font-normal text-muted-foreground">{subtitle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 综合姿态 */}
        <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          <span className={`text-sm font-semibold ${meta.tone}`}>{result.postureLabel}</span>
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {fetchedAt ? `更新 ${new Date(fetchedAt).toLocaleDateString("zh-CN")}` : ""}
          </span>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">{result.summary}</p>

        {/* 各均线研判 */}
        <div className="space-y-2">
          {result.judgments.map((j) => (
            <div
              key={j.period}
              className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{j.label}</span>
                <StatusBadge j={j} />
                <span className={`ml-auto text-[11px] tabular-nums ${statusTone(j)}`}>
                  {j.distancePct == null
                    ? "—"
                    : `${j.distancePct >= 0 ? "+" : ""}${j.distancePct.toFixed(2)}%`}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {usingNav ? "净值" : "现价"}{" "}
                  {j.close == null ? "—" : j.close.toFixed(usingNav ? 4 : 2)}
                </span>
                <span>均线 {j.maValue == null ? "—" : j.maValue.toFixed(usingNav ? 4 : 2)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-foreground/80">{j.advice}</p>
            </div>
          ))}
        </div>

        {/* 规则说明 */}
        <div className="flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            站稳/跌破采用「连续 {CONFIRM_DAYS} 日确认」：{usingNav ? "单位净值" : "收盘价"}连续{" "}
            {CONFIRM_DAYS} 日 ≥ 均线为站稳， 连续 {CONFIRM_DAYS} 日 ≤
            均线为跌破，过滤单日假突破。以上为技术研判，不构成投资建议。
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
