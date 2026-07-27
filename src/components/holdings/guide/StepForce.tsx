/**
 * 步骤 3 — 多空力量 + 一致性：谁主导、信号是否打架。
 * 用力量条 + 冲突/趋势警示，把「多空比」和「护栏原因」翻译成人话。
 *
 * @module components/holdings/guide/StepForce
 */

import { AlertTriangle, Scale } from "lucide-react";
import type { Decision } from "@/services/decision/types";

interface Props {
  decision: Decision;
}

export default function StepForce({ decision }: Props) {
  const bullPct = Math.round(decision.bullRatio * 100);
  const bearPct = 100 - bullPct;
  const whoWins =
    bullPct > bearPct + 10 ? "多方占优" : bearPct > bullPct + 10 ? "空方占优" : "多空胶着";

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
        评分是「结果」，力量条是「过程」。即使综合分不低，如果看涨和看跌的信号
        <b className="text-foreground">各执一词（冲突）</b>
        ，结论也不可靠。先看谁的力量更大，再看它们和不和谐。
      </div>

      {/* 多空力量条 */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="flex items-center gap-1 text-up font-medium">
            <Scale className="h-3.5 w-3.5" /> 多方 {bullPct}%
          </span>
          <span className="text-muted-foreground">{whoWins}</span>
          <span className="flex items-center gap-1 text-down font-medium">
            空方 {bearPct}% <Scale className="h-3.5 w-3.5" />
          </span>
        </div>
        <div
          className="flex h-3 rounded-full overflow-hidden bg-down/30"
          role="meter"
          aria-valuenow={bullPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="多空力量比"
        >
          <div className="h-3 bg-up" style={{ width: `${bullPct}%` }} />
        </div>
      </div>

      {/* 冲突 / 趋势警示 */}
      {(decision.conflict || decision.trendBearish) && (
        <div className="space-y-1.5">
          {decision.conflict && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>信号有冲突：看多和看空的力量分歧较大，结论需打折看待，别盲目跟随。</span>
            </div>
          )}
          {decision.trendBearish && (
            <div className="flex items-start gap-2 rounded-md border border-down/30 bg-down/10 px-2.5 py-1.5 text-[11px] text-down">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>趋势背景偏空：大级别均线呈空头排列，短期反弹可能只是反抽。</span>
            </div>
          )}
        </div>
      )}

      {/* 护栏原因 */}
      {decision.guardrails.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1.5">决策校准说明</h3>
          <ul className="space-y-1">
            {decision.guardrails.map((g, i) => (
              <li
                key={i}
                className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5"
              >
                <span className="text-amber-500 shrink-0">•</span>
                <span>{g.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        👉 下一步：把九维信号一个一个拆开看，每个你都「认不认」？
      </p>
    </div>
  );
}
