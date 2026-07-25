/**
 * 北向资金面板（沪深港通）
 * 展示当日北向净流汇总（按渠道）与北向持仓排名 TOP（个股）。
 * 数据来自 stock-sdk 的 sdk.northbound.summary / holdingRank，受东财增强开关门控。
 * 注：北向持仓为 A 股个股，与 fund-assistant 基金持仓代码空间不同，不直接交叉。
 *
 * @module market/NorthboundPanel
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, RefreshCw } from "lucide-react";
import type { NorthboundFlowSummary, NorthboundHoldingRankItem } from "stock-sdk";
import {
  EastmoneyDisabledError,
  fetchNorthboundHoldingRank,
  fetchNorthboundSummary,
} from "@/services/northbound";
import { formatMoneyCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TOP_N = 12;

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 0 ? "text-up" : "text-down";
}

export default function NorthboundPanel() {
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<NorthboundFlowSummary[]>([]);
  const [rank, setRank] = useState<NorthboundHoldingRankItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const [s, r] = await Promise.all([fetchNorthboundSummary(), fetchNorthboundHoldingRank()]);
      setSummary(s);
      setRank(r);
    } catch (e) {
      if (e instanceof EastmoneyDisabledError) {
        setDisabled(true);
        setSummary([]);
        setRank([]);
      } else {
        setError("北向资金获取失败");
        setSummary([]);
        setRank([]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
          北向资金
          <span className="text-[10px] font-normal text-muted-foreground ml-1">
            沪深港通 · 东财增强
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-end mb-3">
          <Button size="sm" variant="outline" onClick={load} disabled={loading || disabled}>
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            刷新
          </Button>
        </div>

        {disabled ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            北向资金需到「设置 → 数据源」开启东财增强后展示
          </div>
        ) : error ? (
          <div className="text-center py-10 text-sm text-down">{error}</div>
        ) : loading && rank.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* 当日净流汇总 */}
            <div className="grid gap-2 sm:grid-cols-2">
              {summary.map((s) => (
                <div
                  key={s.boardName}
                  className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2"
                >
                  <div className="text-[10px] text-muted-foreground">{s.boardName}</div>
                  <div
                    className={`text-sm font-bold font-mono ${
                      s.netInflow == null
                        ? "text-muted-foreground"
                        : s.netInflow >= 0
                          ? "text-up"
                          : "text-down"
                    }`}
                  >
                    {s.netInflow == null ? "-" : formatMoneyCompact(s.netInflow)}
                  </div>
                </div>
              ))}
            </div>
            {/* 持仓排名 TOP */}
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                北向持仓排名 TOP {TOP_N}
              </div>
              <ul className="divide-y divide-border/40">
                {rank.slice(0, TOP_N).map((it) => (
                  <li key={it.code} className="flex items-center gap-2 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{it.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{it.code}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-xs font-mono font-semibold ${pctColor(it.changePercent)}`}
                      >
                        {it.changePercent == null
                          ? "-"
                          : `${it.changePercent >= 0 ? "+" : ""}${it.changePercent.toFixed(2)}%`}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {it.holdMarketValue == null ? "-" : formatMoneyCompact(it.holdMarketValue)}
                      </div>
                    </div>
                  </li>
                ))}
                {rank.length === 0 && (
                  <li className="px-2 py-6 text-center text-xs text-muted-foreground">暂无数据</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
