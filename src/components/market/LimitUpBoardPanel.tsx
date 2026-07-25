/**
 * 打板情绪面板（涨停池）
 * 展示涨停家数 / 炸板家数 / 炸板率（情绪与风险偏好指标），并支持涨停池类型切换
 * （涨停 / 昨涨停 / 强势 / 次新 / 炸板 / 跌停）查看对应个股列表。
 * 数据来自 stock-sdk 的 sdk.marketEvent.ztPool，受东财增强开关门控。
 *
 * @module market/LimitUpBoardPanel
 */

import { useCallback, useEffect, useState } from "react";
import { Flame, Loader2, RefreshCw } from "lucide-react";
import type { ZTPoolItem, ZTPoolType } from "stock-sdk";
import {
  EastmoneyDisabledError,
  fetchLimitUpPool,
  ZT_POOL_LABELS,
} from "@/services/marketSentiment";
import { formatMoneyCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TOP_N = 12;
const POOL_TYPES: ZTPoolType[] = ["zt", "yesterday", "strong", "sub_new", "broken", "dt"];

function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 0 ? "text-up" : "text-down";
}

export default function LimitUpBoardPanel() {
  const [poolType, setPoolType] = useState<ZTPoolType>("zt");
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ZTPoolItem[]>([]);
  const [stats, setStats] = useState<{ zt: number; broken: number }>({ zt: 0, broken: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const [zt, broken, list] = await Promise.all([
        fetchLimitUpPool("zt"),
        fetchLimitUpPool("broken"),
        fetchLimitUpPool(poolType),
      ]);
      setStats({ zt: zt.length, broken: broken.length });
      setData(list);
    } catch (e) {
      if (e instanceof EastmoneyDisabledError) {
        setDisabled(true);
        setData([]);
      } else {
        setError("涨停池获取失败");
        setData([]);
      }
    }
    setLoading(false);
  }, [poolType]);

  useEffect(() => {
    load();
  }, [load]);

  const total = stats.zt + stats.broken;
  const brokenRate = total > 0 ? (stats.broken / total) * 100 : 0;

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-primary" />
          打板情绪
          <span className="text-[10px] font-normal text-muted-foreground ml-1">
            涨停池 · 东财增强
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 情绪指标 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg border border-up/20 bg-up/5 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">涨停家数</div>
            <div className="text-lg font-bold text-up font-mono">{stats.zt}</div>
          </div>
          <div className="rounded-lg border border-down/20 bg-down/5 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">炸板家数</div>
            <div className="text-lg font-bold text-down font-mono">{stats.broken}</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">炸板率</div>
            <div className="text-lg font-bold font-mono">{brokenRate.toFixed(1)}%</div>
          </div>
        </div>

        {/* 控制条 */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1 flex-wrap">
            {POOL_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setPoolType(t)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  poolType === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted"
                }`}
              >
                {ZT_POOL_LABELS[t]}
              </button>
            ))}
          </div>
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
            打板情绪需到「设置 → 数据源」开启东财增强后展示
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
                  <div className={`text-xs font-mono font-semibold ${pctColor(it.changePercent)}`}>
                    {it.changePercent == null
                      ? "-"
                      : `${it.changePercent >= 0 ? "+" : ""}${it.changePercent.toFixed(2)}%`}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {it.amount == null ? "-" : formatMoneyCompact(it.amount)}
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
