import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { Trophy, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DataAsOf from "@/components/ui/DataAsOf";
import { Button } from "@/components/ui/button";
import { Loader2, Camera } from "lucide-react";
import { useRanking } from "@/hooks/useRankingController";
import type { ScoreSnapshot } from "@/services/backtest/types";
import type { Rating } from "@/services/decision/types";
import type { SignalDirection, FundHolding } from "@/types";
import { TYPE_LABELS } from "@/lib/labels";

const TONE_CLASS: Record<SignalDirection, string> = {
  up: "text-up bg-up/10 border-up/30",
  neutral: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  down: "text-down bg-down/10 border-down/30",
};

function ratingTone(rating: Rating): SignalDirection {
  if (rating === "strong_buy" || rating === "buy") return "up";
  if (rating === "hold") return "neutral";
  return "down";
}

function capitalTone(v: number | null | undefined): SignalDirection | null {
  if (v == null) return null;
  if (v >= 60) return "up";
  if (v < 45) return "down";
  return "neutral";
}

function sectorTone(v: number | null | undefined): SignalDirection | null {
  if (v == null) return null;
  if (v >= 60) return "up";
  if (v < 45) return "down";
  return "neutral";
}

/** 同类排名百分位色调：越小越好（前 25% 红 / 后 50% 绿 / 中间黄） */
function rankTone(v: number | null | undefined): SignalDirection | null {
  if (v == null) return null;
  if (v <= 25) return "up";
  if (v > 50) return "down";
  return "neutral";
}

function fmtPct(v: number | null): string {
  if (v == null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** 基于快照净值与持仓成本估算的浮盈浮亏（%，仅供参考） */
function calcReturnPct(snap: ScoreSnapshot, holding?: FundHolding): number | null {
  if (!holding || !holding.costNAV || holding.costNAV <= 0) return null;
  if (snap.closeValue == null) return null;
  return ((snap.closeValue - holding.costNAV) / holding.costNAV) * 100;
}

/** 持仓评分排名表：消费排行榜控制器，渲染排序后的快照表格 + 展开理由 */
export default function RankingTable() {
  const {
    ranked,
    expanded,
    setExpanded,
    holdingMap,
    hasCapital,
    hasSector,
    hasRank,
    cols,
    rankingAsOf,
    busy,
    handleCapture,
  } = useRanking();
  const navigate = useNavigate();

  if (ranked.length === 0) {
    return (
      <Card className="card-hover">
        <CardContent>
          <div className="text-center py-12 space-y-3">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">暂无评分快照</p>
            <Button size="sm" variant="outline" onClick={handleCapture} disabled={busy}>
              {busy ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Camera className="h-3 w-3 mr-1" />
              )}
              更新今日评分
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2 flex items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5" />
          持仓评分排名
        </CardTitle>
        <DataAsOf asOf={rankingAsOf} label="综合评分" />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-1.5 px-2 w-8">#</th>
                <th className="text-left font-medium py-1.5 px-2">基金</th>
                <th className="text-left font-medium py-1.5 px-2">类型</th>
                <th className="text-right font-medium py-1.5 px-2">收益率*</th>
                <th className="text-right font-medium py-1.5 px-2">综合评分</th>
                <th className="text-left font-medium py-1.5 px-2">评级</th>
                {hasCapital && <th className="text-right font-medium py-1.5 px-2">资金面分</th>}
                {hasSector && <th className="text-right font-medium py-1.5 px-2">赛道分</th>}
                {hasRank && <th className="text-right font-medium py-1.5 px-2">同类排名</th>}
                <th className="text-right font-medium py-1.5 px-2 w-6" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((s, i) => {
                const tone = ratingTone(s.rating);
                const holding = holdingMap.get(s.fundCode);
                const ret = calcReturnPct(s, holding);
                const cap = capitalTone(s.capitalScore);
                const sec = sectorTone(s.sectorScore);
                const rnk = rankTone(s.rankPercentile);
                const isOpen = expanded === s.id;
                const jumpId = holding?.id;
                return (
                  <Fragment key={s.id}>
                    <tr
                      className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : s.id)}
                    >
                      <td className="py-2 px-2 text-muted-foreground font-mono">{i + 1}</td>
                      <td className="py-2 px-2">
                        <div className="truncate max-w-[160px] font-medium">
                          {jumpId ? (
                            <button
                              className="hover:text-primary hover:underline truncate"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(ROUTES.detail(jumpId));
                              }}
                            >
                              {s.fundName}
                            </button>
                          ) : (
                            s.fundName
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {s.fundCode}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {holding?.type ? (TYPE_LABELS[holding.type] ?? "-") : "-"}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-mono ${
                          ret == null ? "text-muted-foreground" : ret >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {fmtPct(ret)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={`font-mono font-semibold ${
                              tone === "up"
                                ? "text-up"
                                : tone === "down"
                                  ? "text-down"
                                  : "text-amber-500"
                            }`}
                          >
                            {s.score}
                          </span>
                          <span className="hidden sm:block h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <span
                              className={`block h-full ${
                                tone === "up"
                                  ? "bg-up"
                                  : tone === "down"
                                    ? "bg-down"
                                    : "bg-amber-500"
                              }`}
                              style={{ width: `${s.score}%` }}
                            />
                          </span>
                        </div>
                        <div className="flex justify-end mt-1">
                          <SourceBadge snap={s} />
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${TONE_CLASS[tone]}`}
                        >
                          {s.ratingLabel}
                        </span>
                      </td>
                      {hasCapital && (
                        <td
                          className={`py-2 px-2 text-right font-mono ${
                            cap
                              ? cap === "up"
                                ? "text-up"
                                : cap === "down"
                                  ? "text-down"
                                  : "text-amber-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {s.capitalScore == null ? (
                            <span
                              title="资金面分需开启「东财资金面增强」（设置 → 数据源）；当前未开启或不可达"
                              className="cursor-help"
                            >
                              —
                            </span>
                          ) : (
                            s.capitalScore.toFixed(0)
                          )}
                        </td>
                      )}
                      {hasSector && (
                        <td
                          className={`py-2 px-2 text-right font-mono ${
                            sec
                              ? sec === "up"
                                ? "text-up"
                                : sec === "down"
                                  ? "text-down"
                                  : "text-amber-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {s.sectorScore == null ? (
                            <span
                              title="赛道分需开启「东财资金面增强」（设置 → 数据源）；按重仓股/ETF 所属行业·概念板块当日强度加权"
                              className="cursor-help"
                            >
                              —
                            </span>
                          ) : (
                            s.sectorScore.toFixed(0)
                          )}
                        </td>
                      )}
                      {hasRank && (
                        <td
                          className={`py-2 px-2 text-right font-mono ${
                            rnk
                              ? rnk === "up"
                                ? "text-up"
                                : rnk === "down"
                                  ? "text-down"
                                  : "text-amber-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {s.rankPercentile == null ? (
                            <span
                              title="同类排名需开启「东财资金面增强」（设置 → 数据源）；取东财同类近三月排名百分位，越小越好"
                              className="cursor-help"
                            >
                              —
                            </span>
                          ) : (
                            <span
                              title={
                                s.rankValue != null && s.rankTotal != null
                                  ? `同类近三月第 ${s.rankValue}/${s.rankTotal} 名（前 ${s.rankPercentile.toFixed(1)}%）`
                                  : `同类近三月排名百分位 ${s.rankPercentile.toFixed(1)}%（越小越好）`
                              }
                              className="cursor-help"
                            >
                              前{s.rankPercentile.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      )}
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        <ChevronDown
                          className={`h-4 w-4 inline transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/40 bg-muted/20">
                        <td colSpan={cols} className="px-3 py-3">
                          <ReasonBlock snap={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-2">
            *
            收益率为基于快照净值与持仓成本的估算，仅供参考；点击行展开查看多空理由，点击基金名跳转详情。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 评分数据来源徽章：标注该评分依赖哪个数据源，及不可达时的后果 */
function SourceBadge({ snap }: { snap: ScoreSnapshot }) {
  const isEtf = snap.valueSource === "etf";
  const label = isEtf ? "真实K线·腾讯" : "净值模式·东财";
  const cls = isEtf
    ? "text-up border-up/30 bg-up/10"
    : "text-amber-500 border-amber-500/30 bg-amber-500/10";
  const tip = isEtf
    ? "评分基于场内 ETF 真实 K 线（腾讯源，当前网络可达），指标置信度高"
    : "评分基于东财净值历史；你当前网络已实测可直连东财，纯净值基金可正常评分";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${cls}`} title={tip}>
      {label}
    </span>
  );
}

function ReasonBlock({ snap }: { snap: ScoreSnapshot }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{snap.summary}</p>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-medium text-up mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            买入理由
          </div>
          {snap.bullReasons.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">无</p>
          ) : (
            <ul className="space-y-0.5">
              {snap.bullReasons.map((r, i) => (
                <li key={i} className="text-[11px] text-foreground/80">
                  · {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[11px] font-medium text-down mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            风险因子
          </div>
          {snap.bearReasons.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">无</p>
          ) : (
            <ul className="space-y-0.5">
              {snap.bearReasons.map((r, i) => (
                <li key={i} className="text-[11px] text-foreground/80">
                  · {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {snap.rankPercentile != null && (
        <p className="text-[11px] text-muted-foreground">
          同类排名：
          <span
            className={
              rankTone(snap.rankPercentile) === "up"
                ? "text-up"
                : rankTone(snap.rankPercentile) === "down"
                  ? "text-down"
                  : "text-amber-500"
            }
          >
            前 {snap.rankPercentile.toFixed(1)}%
          </span>
          {snap.rankValue != null && snap.rankTotal != null && (
            <span className="ml-1">
              （同类近三月第 {snap.rankValue}/{snap.rankTotal} 名）
            </span>
          )}
        </p>
      )}
      {snap.lowConfidence && (
        <p className="text-[10px] text-amber-500">
          基于净值走势（无盘中区间），指标置信度较低，建议切换 ETF 真实 K 线复核。
        </p>
      )}
      {snap.sectorBreakdown && snap.sectorBreakdown.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-1">
            板块赛道贡献（按重仓股权重）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {snap.sectorBreakdown.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-muted/40"
                title={`行业 ${fmtPct(b.industryChangePercent)} · 概念 ${fmtPct(b.conceptChangePercent)}（权重 ${(b.weight * 100).toFixed(0)}%）`}
              >
                <span className="font-medium truncate max-w-[90px]">{b.name || b.symbol}</span>
                <span
                  className={
                    b.industryChangePercent != null && b.industryChangePercent >= 0
                      ? "text-up"
                      : "text-down"
                  }
                >
                  {fmtPct(b.industryChangePercent)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
