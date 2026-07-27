/**
 * 步骤 4（核心）— 九维信号逐个过。
 * 每个维度一张卡：人话翻译 + 你的数值 + 三档含义 + 「你认同吗?」三态收集。
 *
 * @module components/holdings/guide/StepSignals
 */

import { INDICATOR_GLOSSARY } from "@/services/guide/indicatorGlossary";
import type { CategoryView } from "@/services/guide/categoryViews";
import type { FactorVerdict, PerFactorVerdict } from "@/types";
import { TONE_STYLE, VERDICT_STYLE } from "./shared";

interface Props {
  views: CategoryView[];
  perFactor: PerFactorVerdict;
  onVerdict: (category: string, verdict: FactorVerdict) => void;
}

const VERDICTS: FactorVerdict[] = ["agree", "doubt", "disagree"];

/** 单个维度的展示卡（人话 + 数值 + 认同度三态） */
function SignalCard({
  view,
  verdict,
  onVerdict,
}: {
  view: CategoryView;
  verdict?: FactorVerdict;
  onVerdict: (category: string, v: FactorVerdict) => void;
}) {
  const entry = INDICATOR_GLOSSARY[view.category];
  const tone = view.tone ? TONE_STYLE[view.tone] : null;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{entry.label}</span>
        {tone ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.border} ${tone.text}`}
          >
            {tone.label}
            {view.score != null && (
              <span className="ml-1 tabular-nums">
                {view.score > 0 ? "+" : ""}
                {view.score.toFixed(0)}
              </span>
            )}
          </span>
        ) : (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
            背景维度
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">{entry.plain}</p>

      {view.detail && (
        <p className="mt-1 text-[11px] leading-relaxed">
          <span className="text-muted-foreground">你的数据：</span>
          <span className={tone ? tone.text : "text-foreground"}>{view.detail}</span>
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground shrink-0">你认同吗?</span>
        <div className="flex gap-1.5 flex-1">
          {VERDICTS.map((vd) => {
            const st = VERDICT_STYLE[vd];
            const active = verdict === vd;
            return (
              <button
                key={vd}
                type="button"
                aria-pressed={active}
                onClick={() => onVerdict(view.category, vd)}
                className={[
                  "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  active ? st.active : st.idle,
                ].join(" ")}
              >
                {st.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function StepSignals({ views, perFactor, onVerdict }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
        下面是构成结论的<b className="text-foreground">九张「牌」</b>
        。每张牌先用大白话讲它在看什么， 再亮出「你的数值」（偏多/中性/偏空），最后由你来判断——
        <b className="text-foreground">这套分析你认不认？</b>
        你的判断会在最后一步汇总存档。
      </div>

      {views.map((v) => (
        <SignalCard
          key={v.category}
          view={v}
          verdict={perFactor[v.category]}
          onVerdict={onVerdict}
        />
      ))}
    </div>
  );
}
