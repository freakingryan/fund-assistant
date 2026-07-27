/**
 * 向导共享样式与文案 — 涨红跌绿配色、三档语义、三态认同样式。
 * 集中在此，供 5 个 Step 组件复用，避免散落重复（P4 进一步收敛）。
 *
 * @module components/holdings/guide/shared
 */

import type { ScoreTone } from "@/services/guide/indicatorGlossary";
import type { FactorVerdict } from "@/types";

/** 三档语义配色（涨红跌绿、中性），与 DecisionAdvisorCard.RATING_STYLE 保持一致 */
export const TONE_STYLE: Record<
  ScoreTone,
  { text: string; bg: string; border: string; label: string }
> = {
  up: { text: "text-up", bg: "bg-up/10", border: "border-up/30", label: "偏多" },
  down: { text: "text-down", bg: "bg-down/10", border: "border-down/30", label: "偏空" },
  neutral: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    label: "中性",
  },
};

/** 「你认同吗」三态样式（idle=未选，active=已选） */
export const VERDICT_STYLE: Record<FactorVerdict, { label: string; active: string; idle: string }> =
  {
    agree: {
      label: "认同",
      active: "bg-up/15 border-up text-up",
      idle: "border-border text-muted-foreground hover:border-up/40",
    },
    doubt: {
      label: "存疑",
      active: "bg-amber-500/15 border-amber-500 text-amber-600",
      idle: "border-border text-muted-foreground hover:border-amber-500/40",
    },
    disagree: {
      label: "不认同",
      active: "bg-down/15 border-down text-down",
      idle: "border-border text-muted-foreground hover:border-down/40",
    },
  };
