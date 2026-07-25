/**
 * 市场宽度 / 大盘复盘卡（Dashboard 情绪指标）
 *
 * 聚合四类市场级信号，作为基金择时 + 重仓股短线判断的背景：
 *  1. 情绪指标行：涨停 / 跌停 / 炸板家数 + 炸板率（东财增强门控）
 *  2. 行业板块领涨 / 领跌 TOP5（东财增强门控）
 *  3. 主要指数涨跌（stock-api 通道，不依赖东财开关）
 *  4. 市场状态徽标（纯计算，始终显示）
 *
 * 受「东财增强」关闭时，仅 1/2 显示占位，3/4 仍可正常渲染（优雅降级）。
 * 遵循 SectorFundFlowPanel 三态范式 + 涨红跌绿 + card-hover。
 *
 * @module dashboard/MarketBreadthCard
 */

import { useCallback, useEffect, useState, memo } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import type { IndustryBoard, MarketStatus } from "stock-sdk";
import {
  EastmoneyDisabledError,
  fetchLimitUpStats,
  fetchIndustryBoardRank,
  fetchIndexQuotes,
  getMarketStatusCN,
  MARKET_STATUS_LABEL,
  type IndustryBoardRank,
  type IndexQuote,
  type LimitUpStats,
} from "@/services/marketBreadth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** 涨跌幅 → 涨红跌绿配色（中国习惯：涨红跌绿） */
function pctColor(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  return v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground";
}

/** 单个情绪指标 */
const SentimentStat = memo(function ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground";
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border/40 bg-muted/20 px-2 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-mono font-bold leading-tight ${color}`}>{value}</div>
    </div>
  );
});

/** 板块领涨 / 领跌 行 */
const BoardRow = memo(function ({ item, rank }: { item: IndustryBoard; rank: number }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40">
      <span className="w-5 text-center text-[11px] font-mono text-muted-foreground">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">
          {item.leadingStock ?? "-"}
          {item.leadingStockChangePercent != null &&
            ` ${item.leadingStockChangePercent >= 0 ? "+" : ""}${item.leadingStockChangePercent.toFixed(2)}%`}
        </div>
      </div>
      <div className={`text-right text-xs font-mono font-semibold ${pctColor(item.changePercent)}`}>
        {item.changePercent == null
          ? "-"
          : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
      </div>
    </li>
  );
});

/** 指数行 */
const IndexRow = memo(function ({ q }: { q: IndexQuote }) {
  return (
    <li className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/40">
      <span className="truncate text-xs font-medium">{q.name}</span>
      <span className="font-mono text-xs text-muted-foreground">{q.price.toFixed(2)}</span>
      <span className={`font-mono text-xs font-semibold ${pctColor(q.changePercent)}`}>
        {q.changePercent >= 0 ? "+" : ""}
        {q.changePercent.toFixed(2)}%
      </span>
    </li>
  );
});

export default function MarketBreadthCard() {
  const [loading, setLoading] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [limitUp, setLimitUp] = useState<LimitUpStats | null>(null);
  const [limitUpDisabled, setLimitUpDisabled] = useState(false);
  const [limitUpError, setLimitUpError] = useState<string | null>(null);
  const [boards, setBoards] = useState<IndustryBoardRank | null>(null);
  const [boardsDisabled, setBoardsDisabled] = useState(false);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [indicesError, setIndicesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMarketStatus(getMarketStatusCN());
    const [rLimit, rBoards, rIdx] = await Promise.allSettled([
      fetchLimitUpStats(),
      fetchIndustryBoardRank(5),
      fetchIndexQuotes(),
    ]);
    if (rLimit.status === "fulfilled") {
      setLimitUp(rLimit.value);
      setLimitUpDisabled(false);
      setLimitUpError(null);
    } else if (rLimit.reason instanceof EastmoneyDisabledError) {
      setLimitUp(null);
      setLimitUpDisabled(true);
      setLimitUpError(null);
    } else {
      setLimitUp(null);
      setLimitUpDisabled(false);
      setLimitUpError("涨停池获取失败");
    }
    if (rBoards.status === "fulfilled") {
      setBoards(rBoards.value);
      setBoardsDisabled(false);
      setBoardsError(null);
    } else if (rBoards.reason instanceof EastmoneyDisabledError) {
      setBoards(null);
      setBoardsDisabled(true);
      setBoardsError(null);
    } else {
      setBoards(null);
      setBoardsDisabled(false);
      setBoardsError("板块行情获取失败");
    }
    if (rIdx.status === "fulfilled") {
      setIndices(rIdx.value);
      setIndicesError(null);
    } else {
      setIndices([]);
      setIndicesError("指数行情获取失败");
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
          <Activity className="h-3.5 w-3.5 text-primary" />
          市场宽度
          {marketStatus && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground border border-border/40 rounded-full px-1.5 py-0.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  marketStatus === "open" ? "bg-up" : "bg-muted-foreground/50"
                }`}
              />
              {MARKET_STATUS_LABEL[marketStatus]}
            </span>
          )}
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">
            大盘复盘 · 情绪
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 刷新 */}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            刷新
          </Button>
        </div>

        {/* 1. 情绪指标行 */}
        {limitUpDisabled ? (
          <Placeholder
            icon={TriangleAlert}
            text="涨停/跌停/炸板需到「设置 → 数据源」开启东财增强后展示"
          />
        ) : limitUpError ? (
          <div className="text-center py-4 text-sm text-down">{limitUpError}</div>
        ) : !limitUp ? (
          <Loading />
        ) : (
          <div className="flex gap-2">
            <SentimentStat label="涨停" value={String(limitUp.limitUp)} tone="up" />
            <SentimentStat label="跌停" value={String(limitUp.limitDown)} tone="down" />
            <SentimentStat label="炸板" value={String(limitUp.broken)} tone="neutral" />
            <SentimentStat
              label="炸板率"
              value={`${(limitUp.brokenRate * 100).toFixed(1)}%`}
              tone={limitUp.brokenRate >= 0.3 ? "up" : "neutral"}
            />
          </div>
        )}

        {/* 2. 板块领涨 / 领跌 */}
        {boardsDisabled ? (
          <Placeholder
            icon={TriangleAlert}
            text="行业板块领涨/领跌需到「设置 → 数据源」开启东财增强后展示"
          />
        ) : boardsError ? (
          <div className="text-center py-4 text-sm text-down">{boardsError}</div>
        ) : !boards ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-up/20 bg-up/5">
              <div className="px-3 py-2 flex items-center gap-1.5 text-up border-b border-up/20">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">领涨板块 TOP 5</span>
              </div>
              <ul className="py-1">
                {boards.top.length === 0 ? (
                  <Empty />
                ) : (
                  boards.top.map((item, i) => <BoardRow key={item.code} item={item} rank={i + 1} />)
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-down/20 bg-down/5">
              <div className="px-3 py-2 flex items-center gap-1.5 text-down border-b border-down/20">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">领跌板块 TOP 5</span>
              </div>
              <ul className="py-1">
                {boards.bottom.length === 0 ? (
                  <Empty />
                ) : (
                  boards.bottom.map((item, i) => (
                    <BoardRow key={item.code} item={item} rank={i + 1} />
                  ))
                )}
              </ul>
            </div>
          </div>
        )}

        {/* 3. 主要指数（始终渲染，不依赖东财开关） */}
        {indicesError ? (
          <div className="text-center py-3 text-xs text-down">{indicesError}</div>
        ) : indices.length === 0 ? (
          <Loading />
        ) : (
          <div className="rounded-lg border border-border/40 bg-muted/10">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border/30">
              主要指数
            </div>
            <ul className="py-1">
              {indices.map((q) => (
                <IndexRow key={q.code} q={q} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function Empty() {
  return <li className="px-3 py-4 text-center text-xs text-muted-foreground">暂无数据</li>;
}

function Placeholder({ icon: Icon, text }: { icon: typeof TriangleAlert; text: string }) {
  return (
    <div className="text-center py-5 space-y-2">
      <Icon className="h-8 w-8 mx-auto text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
