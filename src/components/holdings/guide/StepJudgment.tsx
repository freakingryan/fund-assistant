/**
 * 步骤 5 — 你的判断 + 存档案：汇总看多/看空证据与你的认同度，给出最终决策与理由。
 *
 * @module components/holdings/guide/StepJudgment
 */

import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { Decision } from "@/services/decision/types";
import type { FactorVerdict, InvestorDecision, PerFactorVerdict } from "@/types";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  decision: Decision;
  perFactor: PerFactorVerdict;
  userDecision: InvestorDecision | null;
  reason: string;
  onDecisionChange: (d: InvestorDecision) => void;
  onReasonChange: (r: string) => void;
}

const DECISION_LABEL: Record<InvestorDecision, string> = {
  add: "加仓",
  hold: "持有",
  reduce: "减仓",
  sell: "卖出",
};
const DECISIONS: InvestorDecision[] = ["add", "hold", "reduce", "sell"];

export default function StepJudgment({
  decision,
  perFactor,
  userDecision,
  reason,
  onDecisionChange,
  onReasonChange,
}: Props) {
  const tally = { agree: 0, doubt: 0, disagree: 0 } as Record<FactorVerdict, number>;
  Object.values(perFactor).forEach((v) => {
    if (v) tally[v] += 1;
  });
  const judged = tally.agree + tally.doubt + tally.disagree;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
        到这里你已经看完所有牌。现在<b className="text-foreground">综合你自己的判断</b>做决定，
        并写下理由。系统会把「当时的评分 + 你对每个维度的认同度 + 你的决策」一起存档，方便日后复盘。
      </div>

      {/* 看多 vs 看空证据 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-up/20 bg-up/5 p-2.5">
          <div className="flex items-center gap-1.5 text-up text-xs font-semibold mb-1.5">
            <ThumbsUp className="h-3.5 w-3.5" /> 看多证据
          </div>
          <ul className="space-y-1">
            {decision.bullReasons.length === 0 && (
              <li className="text-[11px] text-muted-foreground">暂无显著看多信号</li>
            )}
            {decision.bullReasons.map((r, i) => (
              <li key={i} className="text-[11px] leading-relaxed">
                <span className="font-medium text-foreground">{r.label}</span>
                {r.detail && <span className="text-muted-foreground">：{r.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-down/20 bg-down/5 p-2.5">
          <div className="flex items-center gap-1.5 text-down text-xs font-semibold mb-1.5">
            <ThumbsDown className="h-3.5 w-3.5" /> 风险因子
          </div>
          <ul className="space-y-1">
            {decision.bearReasons.length === 0 && (
              <li className="text-[11px] text-muted-foreground">暂无显著看空信号</li>
            )}
            {decision.bearReasons.map((r, i) => (
              <li key={i} className="text-[11px] leading-relaxed">
                <span className="font-medium text-foreground">{r.label}</span>
                {r.detail && <span className="text-muted-foreground">：{r.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 认同度汇总 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>你对各维度的认同度：</span>
        <span className="text-up">认同 {tally.agree}</span>
        <span className="text-amber-600">存疑 {tally.doubt}</span>
        <span className="text-down">不认同 {tally.disagree}</span>
        {judged < 10 && (
          <span className="text-muted-foreground/70">（上一步未全部评价，可返回补充）</span>
        )}
      </div>

      {/* 最终决策 */}
      <div>
        <h3 className="text-sm font-semibold mb-2">你的决策</h3>
        <div className="grid grid-cols-4 gap-2">
          {DECISIONS.map((d) => {
            const active = userDecision === d;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                onClick={() => onDecisionChange(d)}
                className={[
                  "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                ].join(" ")}
              >
                {DECISION_LABEL[d]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 理由 */}
      <div>
        <h3 className="text-sm font-semibold mb-1.5">决策理由（可选）</h3>
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="例如：趋势与量能都偏多，但板块未接入、且我担心短期涨幅过大，所以选择持有观察…"
          className="min-h-[80px] text-xs"
        />
      </div>
    </div>
  );
}
