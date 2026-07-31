/**
 * 观点回测 · 命中率面板
 *
 * - 筛选：日期范围（起始/截止）+ 主题（themeMappings）。
 * - 结果：总信号 / 有效信号 / 命中率 / 平均收益 四张概览卡。
 * - 累计收益曲线（Recharts）：按日等权复利展示「跟随全部信号」的累计收益%。
 * - 按主题命中率表、逐条信号明细表（含取数缺口标记）。
 *
 * @module components/insights/InsightBacktestView
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  Plus,
  ArrowRight,
  Loader2,
  Target,
  AlertTriangle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/stores/db";
import { runBacktest } from "@/services/insightBacktest";
import type { BacktestFilter, BacktestResult, BacktestRow } from "@/services/insightBacktest";
import type { ThemeMapping } from "@/types";
import { ACCURACY_SERIES_COLORS, NEUTRAL_GRAY } from "@/lib/chart-colors";

/** 方向徽标配色（中国习惯：买=红 / 卖=绿 / 持有=灰） */
function dirBadge(dir: BacktestRow["direction"]) {
  if (dir === "buy")
    return {
      label: "买入",
      cls: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200",
    };
  if (dir === "sell")
    return {
      label: "卖出",
      cls: "border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-200",
    };
  return { label: "持有", cls: "border-transparent bg-secondary text-secondary-foreground" };
}

function pctCls(pct: number): string {
  if (pct > 0) return "text-red-600 dark:text-red-400";
  if (pct < 0) return "text-green-600 dark:text-green-400";
  return "text-muted-foreground";
}

function PctText({ pct }: { pct: number }) {
  return (
    <span className={pctCls(pct)}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function InsightBacktestView() {
  const navigate = useNavigate();
  const [mappings, setMappings] = useState<ThemeMapping[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  // 加载主题映射（用于筛选下拉）
  useEffect(() => {
    void db.themeMappings.toArray().then((rows) => setMappings(rows as ThemeMapping[]));
  }, []);

  const run = async (filter: BacktestFilter) => {
    setBusy(true);
    try {
      const r = await runBacktest(filter);
      setResult(r);
    } catch (e) {
      console.error("[backtest] 运行失败", e);
    } finally {
      setBusy(false);
    }
  };

  // 首屏自动跑一次全量（与 AppLayout 取数副作用同款，抑制 set-state-in-effect 告警）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void run({});
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const apply = () =>
    run({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      theme: theme || undefined,
    });

  const themeOptions = useMemo(
    () => [
      { id: "", label: "全部主题" },
      ...mappings.map((m) => ({ id: m.id, label: m.label || m.id })),
    ],
    [mappings],
  );

  const curveData = useMemo(
    () =>
      result?.curve.map((c) => ({
        date: c.date.slice(5), // MM-DD
        cumReturn: c.cumReturn,
      })) ?? [],
    [result],
  );

  const hasInsights = (result?.total ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> 观点回测 · 命中率
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            对历史观点的买卖方向做 T+5 回测，统计命中率与累计收益。数据按需实时抓取，不写回原记录。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/insights/timeline")}>
            时间线 <ArrowRight className="h-4 w-4" />
          </Button>
          <Button onClick={() => navigate("/insights")}>
            <Plus className="h-4 w-4" /> 录入观点
          </Button>
        </div>
      </div>

      {/* 筛选 */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bt-from" className="text-xs">
              起始日期
            </Label>
            <Input
              id="bt-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bt-to" className="text-xs">
              截止日期
            </Label>
            <Input
              id="bt-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">主题</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="全部主题" />
              </SelectTrigger>
              <SelectContent>
                {themeOptions.map((o) => (
                  <SelectItem key={o.id || "all"} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={apply} disabled={busy} className="h-9">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
            运行回测
          </Button>
        </CardContent>
      </Card>

      {!hasInsights && !busy ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="还没有可回测的观点"
            desc="去录入视图粘贴博主观点，或从 ima 知识库同步，录入后即可在此回测命中率。"
            action={
              <Button onClick={() => navigate("/insights")}>
                <Plus className="h-4 w-4" /> 录入观点
              </Button>
            }
          />
        </Card>
      ) : (
        result && (
          <div className="space-y-4">
            {/* 概览卡 */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="扫描信号"
                value={String(result.total)}
                sub={`有效 ${result.evaluated} · 缺口 ${result.gaps}`}
              />
              <StatCard
                label="命中率"
                value={result.accuracy != null ? `${result.accuracy}%` : "—"}
                sub={`命中 ${result.hits} / 有效 ${result.evaluated}`}
              />
              <StatCard
                label="平均收益"
                value={
                  result.avgReturn != null
                    ? `${result.avgReturn > 0 ? "+" : ""}${result.avgReturn}%`
                    : "—"
                }
                sub="T+5 区间（买/卖有效信号）"
              />
              <StatCard
                label="取数缺口"
                value={String(result.gaps)}
                sub="标的历史数据不足 / T+5 未发生"
              />
            </div>

            {/* 累计收益曲线 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  累计收益曲线（跟随全部有效信号，按日等权复利）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {curveData.length === 0 ? (
                  <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">
                    暂无有效信号可绘制曲线
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart
                      data={curveData}
                      margin={{ top: 10, right: 12, bottom: 20, left: -8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={44} />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const v = payload[0].value as number;
                          return (
                            <div className="rounded-md border bg-popover px-2 py-1.5 text-[10px] text-popover-foreground shadow-md">
                              <p className="font-medium">{label}</p>
                              <p className={v >= 0 ? "text-red-600" : "text-green-600"}>
                                累计收益{" "}
                                <span className="font-mono">
                                  {v > 0 ? "+" : ""}
                                  {v}%
                                </span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={0} stroke={NEUTRAL_GRAY} strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="cumReturn"
                        name="累计收益"
                        stroke={ACCURACY_SERIES_COLORS.accuracy}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* 按主题命中率 */}
            {result.byTheme.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">按主题命中率</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>主题</TableHead>
                        <TableHead className="text-right">信号</TableHead>
                        <TableHead className="text-right">命中</TableHead>
                        <TableHead className="text-right">命中率</TableHead>
                        <TableHead className="text-right">平均收益</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.byTheme.map((t) => (
                        <TableRow key={t.theme}>
                          <TableCell className="font-medium">{t.theme}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.total}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.hits}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {t.accuracy != null ? `${t.accuracy}%` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {t.avgReturn != null ? <PctText pct={t.avgReturn} /> : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* 逐条明细 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">逐条信号明细</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead className="sticky left-0 bg-card">日期</TableHead>
                        <TableHead>方向</TableHead>
                        <TableHead>主题</TableHead>
                        <TableHead>标的</TableHead>
                        <TableHead className="text-right">T+5 收益</TableHead>
                        <TableHead className="text-center">命中</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((r, i) => {
                        const b = dirBadge(r.direction);
                        return (
                          <TableRow key={`${r.insightId}-${i}`}>
                            <TableCell className="sticky left-0 bg-card font-mono text-xs text-muted-foreground whitespace-nowrap">
                              {r.date}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}
                              >
                                {b.label}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[180px] truncate" title={r.theme}>
                              {r.theme}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {r.codes.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {r.codes.map((c) => (
                                    <Badge
                                      key={c}
                                      variant="secondary"
                                      className="font-mono text-[10px]"
                                    >
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.gap ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                                  <AlertTriangle className="h-3 w-3" />
                                  缺口
                                </span>
                              ) : r.returnPct != null ? (
                                <PctText pct={r.returnPct} />
                              ) : (
                                <span className="text-[10px] text-muted-foreground">中性</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {r.hit == null ? (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              ) : r.hit ? (
                                <span className="text-red-600 dark:text-red-400">✓</span>
                              ) : (
                                <span className="text-green-600 dark:text-green-400">✗</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              命中判定：买入且 T+5 收涨、卖出且 T+5 收跌即命中；持有与取数缺口不计入命中率。
            </p>
          </div>
        )
      )}
    </div>
  );
}
