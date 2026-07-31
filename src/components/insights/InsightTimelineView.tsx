/**
 * 观点回测 · 按日时间线 / 回看视图
 *
 * - 月历：高亮有观点的日期，点击按日筛选。
 * - 列表：按 date 分组（最新在前），每条 Insight 渲染其 directions[] 为方向卡片。
 * - 详情：点击打开对话框，展示 fullText（Markdown）、当日市场快照、方向卡片与映射标的。
 *
 * @module components/insights/InsightTimelineView
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  Bot,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import Markdown from "@/components/ui/Markdown";
import { db } from "@/stores/db";
import { formatDateOnly } from "@/lib/dataTime";
import type { Insight, InvestmentDirection, MarketSnapshot } from "@/types";

/** 方向徽标配色（中国习惯：买=红 / 卖=绿 / 持有=灰） */
function dirBadge(dir: InvestmentDirection["direction"]) {
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

function DirectionRow({ d }: { d: InvestmentDirection }) {
  const b = dirBadge(d.direction);
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${b.cls}`}
        >
          {b.label}
        </span>
        <span className="text-sm font-medium">{d.theme}</span>
        {d.level && (
          <Badge variant="outline" className="text-[10px]">
            {d.level}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{d.brief}</p>
      {d.mappedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.mappedCodes.map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[10px]">
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SnapshotBlock({ snap }: { snap: MarketSnapshot }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">当日市场快照（{snap.date}）</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {snap.indexes.map((i) => (
          <div key={i.code} className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">{i.name}</div>
            <div className="text-sm font-semibold">
              <PctText pct={i.pct} />
            </div>
          </div>
        ))}
      </div>
      {snap.relatedEtfs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {snap.relatedEtfs.map((e) => (
            <span
              key={e.code}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
            >
              <span className="font-mono text-muted-foreground">{e.code}</span>
              <PctText pct={e.pct} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ s }: { s: Insight["sourceType"] }) {
  if (s === "ima")
    return (
      <Badge variant="secondary" className="gap-1">
        <Bot className="h-3 w-3" />
        ima
      </Badge>
    );
  if (s === "url")
    return (
      <Badge variant="secondary" className="gap-1">
        <Link2 className="h-3 w-3" />
        链接
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <FileText className="h-3 w-3" />
      文本
    </Badge>
  );
}

/** 构建以周一为起始的 6 周月历网格 */
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export default function InsightTimelineView() {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [detail, setDetail] = useState<Insight | null>(null);

  const reload = () => {
    void db.insights
      .orderBy("date")
      .reverse()
      .toArray()
      .then((rows) => setInsights(rows as Insight[]));
  };
  useEffect(reload, []);

  const daysWithInsights = useMemo(() => new Set(insights.map((i) => i.date)), [insights]);
  const grouped = useMemo(() => {
    const map = new Map<string, Insight[]>();
    for (const i of insights) {
      if (selectedDate && i.date !== selectedDate) continue;
      const arr = map.get(i.date) ?? [];
      arr.push(i);
      map.set(i.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [insights, selectedDate]);

  const grid = useMemo(
    () => buildMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()),
    [viewMonth],
  );

  const shiftMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" /> 观点回测 · 时间线
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按日回看投资方向与当日市场动向，点击查看完整分析。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/insights/backtest")}>
            回测面板 <ArrowRight className="h-4 w-4" />
          </Button>
          <Button onClick={() => navigate("/insights")}>
            <Plus className="h-4 w-4" /> 录入观点
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* 月历 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                {viewMonth.getFullYear()} 年 {viewMonth.getMonth() + 1} 月
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => shiftMonth(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => shiftMonth(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((d) => {
                const ds = formatDateOnly(d.getTime());
                const inMonth = d.getMonth() === viewMonth.getMonth();
                const has = daysWithInsights.has(ds);
                const isSel = selectedDate === ds;
                return (
                  <button
                    key={ds}
                    disabled={!has}
                    onClick={() => setSelectedDate(isSel ? null : ds)}
                    className={[
                      "relative h-9 rounded-md text-xs transition-colors",
                      inMonth ? "text-foreground" : "text-muted-foreground/40",
                      has ? "cursor-pointer hover:bg-accent" : "cursor-default",
                      isSel ? "bg-primary text-primary-foreground hover:bg-primary" : "",
                    ].join(" ")}
                  >
                    {d.getDate()}
                    {has && !isSel && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
            {selectedDate && (
              <Button
                variant="link"
                size="sm"
                className="mt-2 h-6 px-0 text-xs"
                onClick={() => setSelectedDate(null)}
              >
                显示全部日期
              </Button>
            )}
          </CardContent>
        </Card>

        {/* 列表 */}
        <div className="space-y-4">
          {grouped.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarDays}
                title="还没有投资观点"
                desc="去录入视图粘贴博主观点，或从 ima 知识库同步。"
                action={
                  <Button onClick={() => navigate("/insights")}>
                    <Plus className="h-4 w-4" /> 录入观点
                  </Button>
                }
              />
            </Card>
          ) : (
            grouped.map(([date, items]) => (
              <div key={date} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-sm font-semibold">{date}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {items.length} 条
                  </Badge>
                </div>
                {items.map((it) => (
                  <Card
                    key={it.id}
                    className="cursor-pointer transition-colors hover:bg-accent/40"
                    onClick={() => setDetail(it)}
                  >
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-center gap-2">
                        <SourceBadge s={it.sourceType} />
                        {it.blogger && (
                          <span className="text-xs text-muted-foreground truncate">
                            {it.blogger}
                          </span>
                        )}
                        <div className="flex-1" />
                        <Badge variant="secondary" className="text-[10px]">
                          {it.mode === "ima-analyzed" ? "ima 已分析" : "AI 分析"}
                        </Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {it.directions.slice(0, 4).map((d) => {
                          const b = dirBadge(d.direction);
                          return (
                            <div
                              key={d.id}
                              className="flex items-start gap-2 rounded-md border bg-background/60 p-2"
                            >
                              <span
                                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}
                              >
                                {b.label}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium">{d.theme}</div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {d.brief}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {it.directions.length > 4 && (
                        <p className="text-[11px] text-muted-foreground">
                          …还有 {it.directions.length - 4} 条方向，点击查看
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 详情对话框 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <SourceBadge s={detail.sourceType} />
                  {detail.date}
                  {detail.blogger && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {detail.blogger}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {detail.mode === "ima-analyzed"
                    ? "ima 已分析结论（轻量抽取）"
                    : "AI 结合当日市场完整分析"}
                  {" · "}共 {detail.directions.length} 条方向
                </DialogDescription>
              </DialogHeader>

              <SnapshotBlock snap={detail.marketSnapshot} />

              {detail.aiAdvice && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">AI 整体建议</p>
                  <p className="rounded-md border bg-muted/40 p-2 text-xs leading-relaxed">
                    {detail.aiAdvice}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">投资方向</p>
                {detail.directions.map((d) => (
                  <DirectionRow key={d.id} d={d} />
                ))}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">完整分析内容</p>
                <div className="rounded-md border bg-muted/20 p-3">
                  <Markdown>{detail.fullText}</Markdown>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
