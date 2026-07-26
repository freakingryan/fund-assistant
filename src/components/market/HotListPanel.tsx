/**
 * 同花顺人气热榜面板。分时 / 日两个维度，展示排名、人气值、涨跌幅、概念标签。
 *
 * @module market/HotListPanel
 */

import { useCallback, useEffect, useState } from "react";
import { Flame, Loader2, RefreshCw } from "lucide-react";
import { getHotList } from "@/services/extraSources/tonghuashun";
import type { TonghuashunHotItem } from "@/types";
import { useSettingsStore } from "@/stores/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExtraSourceGuard } from "./ExtraSourceGuard";

const TOP = 30;

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 0 ? "text-up" : "text-down";
}

function PanelInner() {
  const config = useSettingsStore((s) => s.settings.dataSource.eastmoney);
  const [period, setPeriod] = useState<"hour" | "day">("hour");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<TonghuashunHotItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getHotList(config, period);
      setList(r);
      if (r.length === 0) setError("暂无热榜数据");
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取失败");
      setList([]);
    }
    setLoading(false);
  }, [config, period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-primary" />
          同花顺人气热榜
        </CardTitle>
        <div className="flex gap-1">
          {(["hour", "day"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              className="h-6 text-[10px] px-2"
              onClick={() => setPeriod(p)}
            >
              {p === "hour" ? "分时" : "日"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-end mb-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            刷新
          </Button>
        </div>
        {error ? (
          <div className="text-center py-6 text-sm text-down">{error}</div>
        ) : loading && list.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="divide-y divide-border/40 max-h-[360px] overflow-auto">
            {list.slice(0, TOP).map((it) => (
              <li key={it.code} className="flex items-center gap-2 px-1 py-1.5">
                <span className="w-6 text-center text-[10px] font-mono text-muted-foreground">
                  {it.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{it.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{it.code}</div>
                </div>
                <div className="flex flex-wrap gap-1 max-w-[40%] justify-end">
                  {it.concepts.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="rounded bg-primary/10 text-primary text-[9px] px-1 py-0.5 truncate max-w-[80px]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="text-right w-16 shrink-0">
                  <div className={`text-xs font-mono font-semibold ${pctColor(it.pct)}`}>
                    {it.pct == null ? "-" : `${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(2)}%`}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">人气 {it.heat}</div>
                </div>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">暂无数据</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function HotListPanel() {
  return (
    <ExtraSourceGuard>
      <PanelInner />
    </ExtraSourceGuard>
  );
}
