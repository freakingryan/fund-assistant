/**
 * 步骤 2 — 综合评分速览：0-100 分 + 评级徽章 + 八态动作。
 * 把引擎的「评分」用人话翻译：它在 0~100 的尺子上处在什么位置、对应什么动作。
 *
 * @module components/holdings/guide/StepScore
 */

import type { Decision } from "@/services/decision/types";
import { TONE_STYLE } from "./shared";

interface Props {
  decision: Decision;
}

export default function StepScore({ decision }: Props) {
  const rating = TONE_STYLE[decision.ratingColor];
  const action = TONE_STYLE[decision.actionColor];
  const pct = Math.max(0, Math.min(100, decision.score));

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
        这一分是前面所有指标「打架」后的综合结论，范围 0~100：
        <b className="text-foreground">越高越偏多、越低越偏空</b>。它不是买卖指令，
        而是一个「现在这把牌整体偏向哪边」的刻度，后面几步会拆开看每张牌。
      </div>

      <div className="flex items-center gap-5">
        {/* 评分仪表 */}
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              className="text-muted/30"
              strokeWidth="10"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              className={
                decision.ratingColor === "up"
                  ? "text-up"
                  : decision.ratingColor === "down"
                    ? "text-down"
                    : "text-amber-500"
              }
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 264} 264`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums">{pct}</span>
            <span className="text-[10px] text-muted-foreground">综合分</span>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${rating.bg} ${rating.border} ${rating.text}`}
            >
              {decision.ratingLabel}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${action.bg} ${action.border} ${action.text}`}
            >
              建议：{decision.actionLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {pct >= 70
              ? "评分较高，整体信号偏多。但别只看分数——下一步看多空力量是否一致。"
              : pct >= 45
                ? "评分居中，多空大致均衡或信号不够强。重点看后面有没有冲突。"
                : "评分偏低，整体信号偏弱。留意风险提示，别急着抄底。"}
          </p>
        </div>
      </div>

      {decision.lowConfidence && (
        <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-1.5">
          ⚠️ 当前为净值模式（非场内 ETF 真实 K 线），评分置信度已自动降级，仅作参考。
        </p>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        👉 下一步：看多空谁占上风，以及信号之间有没有「打架」。
      </p>
    </div>
  );
}
