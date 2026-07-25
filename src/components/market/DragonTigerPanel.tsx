/**
 * 龙虎榜面板（上榜明细）
 * 展示当日龙虎榜个股（按龙虎榜净买额降序 TOP），含收盘价 / 涨跌幅 / 净买额。
 * 数据来自 stock-sdk 的 sdk.dragonTiger.detail，受东财增强开关门控。
 *
 * @module market/DragonTigerPanel
 */

import { useCallback, useEffect, useState } from "react";
import { ListOrdered, Loader2, RefreshCw } from "lucide-react";
import type { DragonTigerDetailItem } from "stock-sdk";
import { EastmoneyDisabledError, fetchDragonTigerDetail } from "@/services/dragonTiger";
import { formatMoneyCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TOP_N = 12;

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 0 ? "text-up" : "text-down";
}

export default function DragonTigerPanel() {
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DragonTigerDetailItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const items = await fetchDragonTigerDetail();
      setData(
        [...items].sort((a, b) => (b.netBuyAmount ?? -Infinity) - (a.netBuyAmount ?? -Infinity)),
      );
    } catch (e) {
      if (e instanceof EastmoneyDisabledError) {
        setDisabled(true);
        setData([]);
      } else {
        setError("龙虎榜获取失败");
        setData([]);
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
          <ListOrdered className="h-3.5 w-3.5 text-primary" />
          龙虎榜
          <span className="text-[10px] font-normal text-muted-foreground ml-1">
            上榜明细 · 净买额排序
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
            龙虎榜需到「设置 → 数据源」开启东财增强后展示
          </div>
        ) : error ? (
          <div className="text-center py-10 text-sm text-down">{error}</div>
        ) : loading && data.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {data.slice(0, TOP_N).map((it) => (
              <li key={it.code} className="flex items-center gap-2 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{it.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{it.code}</div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-xs font-mono font-semibold ${
                      it.netBuyAmount == null
                        ? "text-muted-foreground"
                        : it.netBuyAmount >= 0
                          ? "text-up"
                          : "text-down"
                    }`}
                  >
                    {it.netBuyAmount == null ? "-" : formatMoneyCompact(it.netBuyAmount)}
                  </div>
                  <div className={`text-[10px] font-mono ${pctColor(it.changePercent)}`}>
                    {it.changePercent == null
                      ? "-"
                      : `${it.changePercent >= 0 ? "+" : ""}${it.changePercent.toFixed(2)}%`}
                  </div>
                </div>
              </li>
            ))}
            {data.length === 0 && (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">暂无数据</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
