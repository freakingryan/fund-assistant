/**
 * 一致预期EPS 面板（同花顺 worth.html / GBK 依赖无关抽取）。
 * 按股票代码查询机构一致预期EPS（年度 / 机构数 / 最小 / 均值 / 最大）。
 *
 * @module market/ConsensusEpsPanel
 */

import { useCallback, useState } from "react";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { getConsensusEps } from "@/services/extraSources/tonghuashun";
import type { TonghuashunEps } from "@/types";
import { useSettingsStore } from "@/stores/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExtraSourceGuard } from "./ExtraSourceGuard";

function num(v: number | null): string {
  return v == null ? "-" : v.toFixed(2);
}

function PanelInner() {
  const config = useSettingsStore((s) => s.settings.dataSource.eastmoney);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TonghuashunEps[]>([]);

  const load = useCallback(
    async (c: string) => {
      const q = c.trim();
      if (!q) return;
      setLoading(true);
      setError(null);
      try {
        const r = await getConsensusEps(q, config);
        setData(r);
        if (r.length === 0) setError("未解析到一致预期EPS（可能该股票无机构覆盖）");
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取失败");
        setData([]);
      }
      setLoading(false);
    },
    [config],
  );

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          一致预期EPS
          <span className="text-[10px] font-normal text-muted-foreground ml-1">同花顺</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            load(code);
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6 位股票代码，如 600519"
            className="h-8 text-xs"
          />
          <Button size="sm" type="submit" disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </form>
        {error ? (
          <div className="text-center py-6 text-sm text-down">{error}</div>
        ) : loading && data.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            输入代码查询机构一致预期EPS
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left py-1 font-medium">年度</th>
                <th className="text-right py-1 font-medium">机构</th>
                <th className="text-right py-1 font-medium">最小</th>
                <th className="text-right py-1 font-medium">均值</th>
                <th className="text-right py-1 font-medium">最大</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.year} className="border-b border-border/30">
                  <td className="py-1.5 font-medium">{d.year}</td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                    {d.agencyCount ?? "-"}
                  </td>
                  <td className="py-1.5 text-right font-mono">{num(d.min)}</td>
                  <td className="py-1.5 text-right font-mono font-semibold text-primary">
                    {num(d.avg)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{num(d.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function ConsensusEpsPanel() {
  return (
    <ExtraSourceGuard>
      <PanelInner />
    </ExtraSourceGuard>
  );
}
