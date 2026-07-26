/**
 * 互动易问答面板（巨潮 cninfo）。按股票代码查询投资者提问 + 公司回复。
 *
 * @module market/IrmPanel
 */

import { useCallback, useState } from "react";
import { Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { getIrmQa } from "@/services/extraSources/cninfo";
import type { CninfoIrmItem } from "@/types";
import { useSettingsStore } from "@/stores/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExtraSourceGuard } from "./ExtraSourceGuard";

function fmtTime(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function PanelInner() {
  const config = useSettingsStore((s) => s.settings.dataSource.eastmoney);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<CninfoIrmItem[]>([]);

  const load = useCallback(
    async (c: string) => {
      const q = c.trim();
      if (!q) return;
      setLoading(true);
      setError(null);
      try {
        const r = await getIrmQa(q, config);
        setList(r);
        if (r.length === 0) setError("未找到互动易问答（可能该公司不回复或代码无匹配）");
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取失败");
        setList([]);
      }
      setLoading(false);
    },
    [config],
  );

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          互动易问答
          <span className="text-[10px] font-normal text-muted-foreground ml-1">巨潮</span>
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
            placeholder="6 位股票代码，如 002594"
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
        ) : loading && list.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            输入代码查询互动易问答
          </div>
        ) : (
          <ul className="space-y-2 max-h-[360px] overflow-auto">
            {list.map((it, i) => (
              <li key={i} className="rounded-md border border-border/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{it.company ?? it.code}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtTime(it.askTime)}</span>
                </div>
                <p className="text-xs mt-1">
                  <span className="text-muted-foreground">Q: </span>
                  {it.question}
                </p>
                {it.answer ? (
                  <p className="text-xs mt-1">
                    <span className="text-primary">A: </span>
                    {it.answer}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground mt-1">（未回复）</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function IrmPanel() {
  return (
    <ExtraSourceGuard>
      <PanelInner />
    </ExtraSourceGuard>
  );
}
