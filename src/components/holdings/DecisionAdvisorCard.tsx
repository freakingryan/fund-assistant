/**
 * 决策建议卡 — 融合形态/指标/评分/策略后的唯一决策出口
 *
 * 展示：评级徽章(涨红跌绿) + 0-100 综合评分 + 多空力量条 + 一致性/冲突警示
 * + 市场 regime 状态 + 东财增强因子(叠加层，可见 graceful degradation)
 * + 买入理由(看多证据) + 风险因子(看空证据) + 命中命名策略 + 人话总结。
 * 原有三张卡（综合评分/技术指标/形态）降级为"分析明细"，可折叠查看。
 *
 * @module DecisionAdvisorCard
 */

import { useMemo } from "react";
import {
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  TrendingUp,
  Activity,
  Layers,
  Scale,
  ShieldAlert,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KLineData } from "@/types";
import type { DetectedPattern } from "@/services/klinePatterns";
import type { SignalResult } from "@/services/signalEngine";
import { computeStockSdkIndicators } from "@/services/stockSdkIndicators";
import { evaluateStrategies } from "@/services/strategyLayer";
import { buildDecision, ACTION_META } from "@/services/decision/decisionEngine";
import { computeNavFactors } from "@/services/decision/navFactors";
import type {
  SignalCategory,
  EmFactors,
  MarketRegime,
  RiskProfile,
} from "@/services/decision/types";
import DataAsOf from "@/components/ui/DataAsOf";

interface Props {
  klines: KLineData[];
  patterns: DetectedPattern[];
  signalResult: SignalResult | null;
  /** 是否场内 ETF 真实 K 线；false 表示净值走势（置信度低） */
  isRealKline?: boolean;
  /** 东财交叉截面因子（overlay）；缺省表示未接入，不影响评分 */
  em?: EmFactors;
  /** 市场 regime（剥离 beta 伪信号）；缺省表示未计算 */
  regime?: MarketRegime;
  /** 联接基金自身 NAV 序列（仅 isRealKline 场景传入，用于算跟踪误差折扣） */
  navKlines?: KLineData[];
  /** 该评分所基于的数据时点（K 线末根日期），用于展示「综合评分截至 …」 */
  asOf?: number | null;
  /** K 线数据的调用 / 缓存写入时间（回退获取时间） */
  fetchedAt?: number | null;
}

const CAT_LABEL: Record<SignalCategory, string> = {
  trend: "趋势",
  macd: "MACD",
  momentum: "动量",
  bias: "乖离",
  volume: "量能",
  pattern: "形态",
  navmom: "净值",
  capitalflow: "资金面",
  sector: "板块",
  peer: "排名",
};

const RATING_STYLE: Record<
  "up" | "down" | "neutral",
  { text: string; bg: string; border: string }
> = {
  up: { text: "text-up", bg: "bg-up/10", border: "border-up/30" },
  down: { text: "text-down", bg: "bg-down/10", border: "border-down/30" },
  neutral: { text: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30" },
};

export function DecisionAdvisorCard({
  klines,
  patterns,
  signalResult,
  isRealKline = true,
  em,
  regime,
  navKlines,
  asOf,
  fetchedAt,
}: Props) {
  // 净值基金：用 NAV 收盘价序列算原生因子（纯本地），给自身方向性依据（同时供 UI 展示状态）
  const nav = useMemo(
    () => (!isRealKline && klines.length > 0 ? computeNavFactors(klines) : undefined),
    [klines, isRealKline],
  );

  const decision = useMemo(() => {
    if (klines.length === 0) return null;
    const ind = computeStockSdkIndicators(klines);
    const strategies = evaluateStrategies(klines, ind);
    return buildDecision({
      klines,
      patterns,
      signalResult,
      ind,
      strategies,
      lowConfidence: !isRealKline,
      nav,
      em,
      regime,
      navKlines,
    });
  }, [klines, patterns, signalResult, isRealKline, nav, em, regime, navKlines]);

  if (!decision) return null;

  const style = RATING_STYLE[decision.actionColor];
  const bullPct = Math.round(decision.bullRatio * 100);
  const bearPct = 100 - bullPct;
  const showEmDelta = decision.emDelta !== 0;

  return (
    <Card className="card-hover border-2 border-primary/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          智能决策建议
          <span className="text-[10px] font-normal text-muted-foreground/60 ml-auto flex items-center gap-2">
            <DataAsOf asOf={asOf} fetchedAt={fetchedAt} inline label="综合评分" />
            <span className="hidden sm:inline">形态·指标·评分·策略 融合</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 八态 action 徽章 + 评分 + 状态徽章 */}
        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-lg text-base font-bold border ${style.text} ${style.bg} ${style.border}`}
          >
            {decision.actionLabel}
          </div>
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40 border border-border/40">
            评级 {decision.ratingLabel}
          </span>
          {decision.signalType === "reversion" && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
              超卖反弹·非趋势
            </span>
          )}
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">综合评分 (0-100)</span>
            <span className={`text-lg font-bold leading-none ${style.text}`}>
              {decision.score}
              {showEmDelta && (
                <span
                  className={`ml-1 text-[10px] font-normal ${decision.emDelta > 0 ? "text-up" : "text-down"}`}
                >
                  {decision.emDelta > 0 ? "+" : ""}
                  {decision.emDelta}
                </span>
              )}
            </span>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            {decision.lowConfidence && (
              <span className="text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/40">
                净值模式·置信度低
              </span>
            )}
            {decision.navAvailable && (
              <span className="text-[10px] text-primary/80 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                已启用净值因子
              </span>
            )}
          </div>
        </div>

        {/* 多空力量条（可访问性：meter 角色 + aria 标签） */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span className="text-up">多头 {bullPct}%</span>
            <span className="text-down">空头 {bearPct}%</span>
          </div>
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bullPct}
            aria-label={`多空力量：多头 ${bullPct}%，空头 ${bearPct}%`}
            className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted/40"
          >
            <div
              className="h-full bg-up transition-all duration-500 ease-out"
              style={{ width: `${bullPct}%` }}
            />
            <div
              className="h-full bg-down transition-all duration-500 ease-out"
              style={{ width: `${bearPct}%` }}
            />
          </div>
        </div>

        {/* 决策校准（八态 action + 护栏原因，可解释） */}
        <div className="rounded-md border border-border/50 p-2.5 space-y-2 bg-muted/10">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Scale className="h-3 w-3" />
            决策校准（评分 / 动作演变 + 护栏原因）
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-muted-foreground mb-0.5">评分</div>
              <div className="text-[11px] font-semibold">
                <span className="text-muted-foreground/70">{decision.rawScore}</span>
                <span className="mx-1 text-muted-foreground/40">→</span>
                <span className={style.text}>{decision.adjustedScore}</span>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-muted-foreground mb-0.5">动作</div>
              <div className="text-[11px] font-semibold">
                <span className="text-muted-foreground/70">
                  {ACTION_META[decision.rawAction].label}
                </span>
                <span className="mx-1 text-muted-foreground/40">→</span>
                <span className={style.text}>{decision.actionLabel}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground mb-0.5">
              护栏原因（数据降级 → 决策降级 + 显式原因）
            </div>
            {decision.guardrails.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/70">评分与动作一致，无护栏调整</p>
            ) : (
              <ul className="space-y-1">
                {decision.guardrails.map((g, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 leading-snug"
                  >
                    <ShieldAlert className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{g.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 冲突 / 趋势 / 中期下行 警示 */}
        {(decision.conflict || decision.trendBearish || decision.midTermDown) && (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {decision.conflict && "多空信号分歧较大，结论可靠性下降，建议以观望为主。"}
              {decision.conflict && (decision.trendBearish || decision.midTermDown) && " "}
              {decision.trendBearish && "当前处于空头排列趋势，反弹空间受限，不宜追高。"}
              {decision.trendBearish && decision.midTermDown && " "}
              {decision.midTermDown &&
                `中期趋势仍处下行（近三月 ${decision.midTermReturnPct.toFixed(1)}%），反弹空间取决于资金与板块配合。`}
            </span>
          </div>
        )}

        {/* 市场状态 + 增强因子（透明呈现新增因子与 graceful degradation） */}
        <div className="space-y-1.5">
          {regime && <RegimeChip regime={regime} />}
          {em ? (
            <EnhancementStrip em={em} />
          ) : (
            <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Layers className="h-3 w-3" />
              增强因子加载中…
            </p>
          )}
        </div>

        {/* 波动 / 仓位（只读参考）：纯量化参考，不改变评级 / 动作 */}
        {decision.riskProfile && <RiskProfilePanel risk={decision.riskProfile} />}

        {/* 人话总结 */}
        <p className="text-[11px] text-foreground/80 leading-relaxed bg-muted/15 rounded px-2 py-1.5">
          {decision.summary}
        </p>

        {/* 买入理由 / 风险因子 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ReasonColumn
            icon={<ThumbsUp className="h-3.5 w-3.5 text-up" />}
            title="买入理由"
            titleClass="text-up"
            items={decision.bullReasons}
          />
          <ReasonColumn
            icon={<ThumbsDown className="h-3.5 w-3.5 text-down" />}
            title="风险因子"
            titleClass="text-down"
            items={decision.bearReasons}
          />
        </div>

        {/* 命中策略 */}
        {decision.strategies.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />
              命中策略
            </div>
            <div className="flex flex-wrap gap-1.5">
              {decision.strategies.map((s) => (
                <span
                  key={s.id}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    s.direction === "bull"
                      ? "text-up bg-up/10 border-up/30"
                      : s.direction === "bear"
                        ? "text-down bg-down/10 border-down/30"
                        : "text-muted-foreground bg-muted/30 border-border/40"
                  }`}
                  title={s.detail}
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] text-muted-foreground/40 text-right">
          技术分析仅供参考，不构成投资建议
        </p>
      </CardContent>
    </Card>
  );
}

/** 市场 regime 状态徽章：直观呈现大盘偏多/偏空（剥离 beta 伪信号） */
function RegimeChip({ regime }: { regime: MarketRegime }) {
  const cfg = {
    bull: {
      label: `市场偏多${regime.momentum60 != null ? ` +${regime.momentum60.toFixed(1)}%` : ""}`,
      cls: "text-up bg-up/10 border-up/30",
    },
    bear: {
      label: `市场偏空${regime.momentum60 != null ? ` ${regime.momentum60.toFixed(1)}%` : ""}`,
      cls: "text-down bg-down/10 border-down/30",
    },
    neutral: { label: "市场中性", cls: "text-muted-foreground bg-muted/40 border-border/40" },
  }[regime.trend];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${cfg.cls}`}
      title={`沪深300 近60日 ${regime.momentum60 != null ? regime.momentum60.toFixed(1) + "%" : "—"}；MA20 ${regime.maBull ? "≥" : "<"} MA60${decisionHint(regime.trend)}`}
    >
      <Activity className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function decisionHint(trend: MarketRegime["trend"]): string {
  if (trend === "bull") return "（多头市对悲观信号打折）";
  if (trend === "bear") return "（空头市对乐观信号打折）";
  return "";
}

/** 东财增强因子展示条：可用显示分值，不可用显示「未接入」以体现 graceful degradation */
function EnhancementStrip({ em }: { em: EmFactors }) {
  const allUnavailable =
    !em.capitalFlow.available && !em.sector.available && !em.peerRank.available;
  return (
    <div className="rounded-md border border-border/50 p-2 space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Layers className="h-3 w-3" />
        增强因子 · 东财交叉截面
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FactorPill
          label="资金面"
          available={em.capitalFlow.available}
          value={em.capitalFlow.combinedScore}
          kind="score50"
        />
        <FactorPill
          label="板块"
          available={em.sector.available}
          value={em.sector.combinedScore}
          kind="score50"
        />
        <FactorPill
          label="排名"
          available={em.peerRank.available}
          value={em.peerRank.percentile}
          kind="percentile"
        />
      </div>
      {allUnavailable && (
        <p className="text-[9px] text-muted-foreground/60">
          东财未接入 / 不可用：评分纯本地计算，结论不受影响（叠加层增量恒为 0）。
        </p>
      )}
    </div>
  );
}

/** 波动 / 仓位风险画像（只读参考面板）：量化波动水平，给出仓位 / 止损参考，不改变任何决策 */
function RiskProfilePanel({ risk }: { risk: RiskProfile }) {
  const tierMeta = {
    low: { label: "低波动", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
    medium: { label: "中波动", cls: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
    high: { label: "高波动", cls: "text-red-600 bg-red-500/10 border-red-500/30" },
  }[risk.volTier];
  return (
    <div className="rounded-md border border-dashed border-border/60 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Gauge className="h-3 w-3" />
          波动 / 仓位（只读参考）
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tierMeta.cls}`}>
          {tierMeta.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Stat label="年化波动" value={`${risk.annualizedVol}%`} />
        <Stat label="最大回撤" value={`${risk.maxDrawdown}%`} />
        <Stat label="ATR%" value={risk.atrPct > 0 ? `${risk.atrPct}%` : "—"} />
      </div>
      <p className="text-[10px] text-muted-foreground/80 leading-snug">
        建议最大单标的仓位{" "}
        <span className="font-medium text-foreground/90">{risk.suggestedMaxPosition}%</span>
        {" · "}止损参考 <span className="font-medium text-foreground/90">{risk.stopLossPct}%</span>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/20 py-1">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-semibold text-foreground/90 tabular-nums">{value}</div>
    </div>
  );
}

function FactorPill({
  label,
  available,
  value,
  kind,
}: {
  label: string;
  available: boolean;
  value: number | null;
  kind: "score50" | "percentile";
}) {
  if (!available || value == null) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground/60 border border-border/30">
        {label}·未接入
      </span>
    );
  }
  let cls = "text-muted-foreground bg-muted/40 border-border/40";
  let text: string;
  if (kind === "score50") {
    text = `${label} ${value.toFixed(0)}`;
    if (value >= 55) cls = "text-up bg-up/10 border-up/30";
    else if (value <= 45) cls = "text-down bg-down/10 border-down/30";
  } else {
    text = `排名前${value.toFixed(0)}%`;
    if (value <= 40) cls = "text-up bg-up/10 border-up/30";
    else if (value >= 60) cls = "text-down bg-down/10 border-down/30";
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${cls}`}
      title={
        kind === "score50"
          ? `${label}：${value.toFixed(0)}/100（50 中性）`
          : `${label}：前 ${value.toFixed(1)}%（越小越好）`
      }
    >
      {text}
    </span>
  );
}

function ReasonColumn({
  icon,
  title,
  titleClass,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  titleClass: string;
  items: { label: string; detail: string; category: SignalCategory }[];
}) {
  return (
    <div className="rounded-md border border-border/50 p-2">
      <div className={`flex items-center gap-1 text-[11px] font-semibold mb-1.5 ${titleClass}`}>
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60">暂无显著信号</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-[10px] leading-snug">
              <span className="inline-block text-[9px] text-muted-foreground/50 mr-1 px-1 rounded bg-muted/40 align-middle">
                {CAT_LABEL[it.category]}
              </span>
              <span className="text-foreground/80">{it.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
