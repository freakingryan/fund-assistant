/**
 * 研报中心卡片（东方财富 reportapi）
 *
 * 展示个股 / ETF 的研报列表：标题、发布日期、机构、评级、三年 EPS 预测、PDF 链接。
 * 数据来自 stock-sdk 的 sdk.report.list，受「东财增强」开关门控（与北向/龙虎榜同款）。
 * 挂在基金详情页时由父级传入关联场内 ETF 代码（etfCode）。
 *
 * @module holdings/ResearchReportCard
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import type { ResearchReport } from "stock-sdk";
import { EastmoneyDisabledError, fetchResearchReports } from "@/services/researchReport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SHOW_N = 12;

/** 评级 → 语义色（中国习惯：买入/增持=红，减持/卖出=绿，中性=灰） */
function ratingClass(rating: string): string {
  const r = rating.trim();
  if (r.includes("买入") || r.includes("增持")) return "text-up border-up/40 bg-up/5";
  if (r.includes("减持") || r.includes("卖出")) return "text-down border-down/40 bg-down/5";
  return "text-muted-foreground border-border/40 bg-muted/20";
}

function epsText(r: ResearchReport): string | null {
  const parts: string[] = [];
  if (r.predictNextYearEps != null) parts.push(`次年 ${r.predictNextYearEps.toFixed(2)}`);
  if (r.predictNextTwoYearEps != null) parts.push(`后年 ${r.predictNextTwoYearEps.toFixed(2)}`);
  return parts.length ? `EPS ${parts.join(" / ")}` : null;
}

interface Props {
  /** 关联个股 / ETF 代码；为 null 时提示「无关联场内标的」 */
  stockCode: string | null;
  /** 关联标的名称（用于副标题展示） */
  stockName?: string;
}

export default function ResearchReportCard({ stockCode, stockName }: Props) {
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ResearchReport[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!stockCode) return;
    setLoading(true);
    setError(null);
    setDisabled(false);
    try {
      const res = await fetchResearchReports({ stockCode });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      if (e instanceof EastmoneyDisabledError) {
        setDisabled(true);
        setItems([]);
      } else {
        setError("研报获取失败");
        setItems([]);
      }
    }
    setLoading(false);
  }, [stockCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载即拉取研报，setState 在异步请求前触发属预期
    load();
  }, [load]);

  const subtitle = stockName ? `${stockName} · ${stockCode}` : stockCode ? stockCode : "东财增强";

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-primary" />
          研报中心
          <span className="text-[10px] font-normal text-muted-foreground ml-1">
            {subtitle} · 东财增强
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-end mb-3">
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading || disabled || !stockCode}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            刷新
          </Button>
        </div>

        {!stockCode ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            该基金无关联场内标的，暂无法展示研报（仅 ETF / 场内基金支持）
          </div>
        ) : disabled ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            研报需到「设置 → 数据源」开启东财增强后展示
          </div>
        ) : error ? (
          <div className="text-center py-10 text-sm text-down">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-muted-foreground mb-1">
              共 {total} 篇研报 · 展示最新 {Math.min(SHOW_N, items.length)} 篇
            </div>
            <ul className="divide-y divide-border/40">
              {items.slice(0, SHOW_N).map((r) => {
                const eps = epsText(r);
                return (
                  <li key={r.infoCode} className="px-1 py-2">
                    <a
                      href={r.pdfUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium group-hover:text-primary">
                          {r.title || "（无标题）"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span>{r.publishDate}</span>
                          <span>·</span>
                          <span>{r.orgName || "未知机构"}</span>
                          {eps && (
                            <>
                              <span>·</span>
                              <span className="font-mono">{eps}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {r.ratingName && (
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${ratingClass(
                              r.ratingName,
                            )}`}
                          >
                            {r.ratingName}
                          </span>
                        )}
                        {r.pdfUrl && (
                          <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                        )}
                      </div>
                    </a>
                  </li>
                );
              })}
              {items.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-muted-foreground">暂无研报</li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
