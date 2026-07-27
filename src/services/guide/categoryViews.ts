/**
 * 维度视图派生 — 把真实数据归并成 SOP「九维逐个过」所需的逐卡展示结构。
 *
 * 策略（诚实、不伪造数字）：
 *  - 6 个真实评分贡献（signalResult.contributions）经 CONTRIB_CATEGORY_MAP 归并到
 *    趋势/MACD/动量/量能/形态，给出真实归一化分（-10~+10）与原文。
 *  - 乖离(bias) 无独立评分，标注「已并入趋势/动量」。
 *  - 净值(navmom) 仅在净值模式且有 NAV 因子时作为「可用」背景维度。
 *  - 资金面/板块/排名(capitalflow/sector/peer) 取东财 overlay 的 0-100 分，
 *    归一化到 -10~+10；未接入时 available=false，仅展示通识。
 *
 * 纯函数、只读，不改动任何评分算法。
 *
 * @module services/guide/categoryViews
 */

import type { SignalResult } from "@/services/signalEngine";
import type { Decision, EmFactors, SignalCategory } from "@/services/decision/types";
import {
  CONTRIB_CATEGORY_MAP,
  GLOSSARY_ORDER,
  INDICATOR_GLOSSARY,
  interpretScore,
  type ScoreTone,
} from "./indicatorGlossary";

export interface CategoryView {
  category: SignalCategory;
  label: string;
  /** 归一化到 -10~+10 的贡献分；无数值时为 null（仅展示通识） */
  score: number | null;
  tone: ScoreTone | null;
  /** 该维度给用户的「你的数值」原文（贡献 detail 或 overlay 状态） */
  detail: string | null;
  /** 数据是否可得：overlay 未接入时为 false，仅展示通识 */
  available: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 0-100 分 → -10~+10（围绕中性 50） */
const norm100 = (v: number) => clamp((v - 50) / 5, -10, 10);

/**
 * 构建九维 + 排名的展示视图（按 GLOSSARY_ORDER 顺序）。
 * @param signalResult 综合评分结果（贡献明细），可为 null
 * @param decision 融合决策（取 navAvailable 等状态），可为 null
 * @param em 东财 overlay 因子，可为 undefined
 */
export function buildCategoryViews(
  signalResult: SignalResult | null,
  decision: Decision | null,
  em?: EmFactors,
): CategoryView[] {
  // 1) 归并真实贡献分：category -> { sum, details[] }
  const agg: Partial<Record<SignalCategory, { sum: number; details: string[] }>> = {};
  if (signalResult) {
    for (const c of signalResult.contributions) {
      if (c.score === 0) continue;
      const cat = CONTRIB_CATEGORY_MAP[c.key];
      if (!cat) continue;
      if (!agg[cat]) agg[cat] = { sum: 0, details: [] };
      agg[cat]!.sum = clamp(agg[cat]!.sum + c.score, -10, 10);
      if (c.detail) agg[cat]!.details.push(c.detail);
    }
  }

  return GLOSSARY_ORDER.map((cat) => {
    const entry = INDICATOR_GLOSSARY[cat];

    // overlay 维度（资金面/板块/排名）：取东财 0-100 分归一化
    if (
      cat === "capitalflow" &&
      em?.capitalFlow.available &&
      em.capitalFlow.combinedScore != null
    ) {
      const s = norm100(em.capitalFlow.combinedScore);
      return {
        category: cat,
        label: entry.label,
        score: s,
        tone: interpretScore(s),
        detail: `资金面评分 ${em.capitalFlow.combinedScore.toFixed(0)}/100`,
        available: true,
      };
    }
    if (cat === "sector" && em?.sector.available && em.sector.combinedScore != null) {
      const s = norm100(em.sector.combinedScore);
      return {
        category: cat,
        label: entry.label,
        score: s,
        tone: interpretScore(s),
        detail: `板块评分 ${em.sector.combinedScore.toFixed(0)}/100`,
        available: true,
      };
    }
    if (cat === "peer" && em?.peerRank.available && em.peerRank.percentile != null) {
      const s = norm100(em.peerRank.percentile);
      return {
        category: cat,
        label: entry.label,
        score: s,
        tone: interpretScore(s),
        detail: `同类排名百分位 ${em.peerRank.percentile.toFixed(0)}%`,
        available: true,
      };
    }

    // 净值动量（仅净值模式 + NAV 因子可用）
    if (cat === "navmom") {
      const ok = !!decision?.navAvailable;
      return {
        category: cat,
        label: entry.label,
        score: null,
        tone: null,
        detail: ok ? "净值动量因子可用（见趋势/动量维度）" : "非净值模式或未计算",
        available: ok,
      };
    }

    // 乖离：无独立评分
    if (cat === "bias") {
      return {
        category: cat,
        label: entry.label,
        score: null,
        tone: null,
        detail: "无独立评分（已并入趋势/动量维度）",
        available: true,
      };
    }

    // 其余：来自真实贡献分
    const a = agg[cat];
    if (a && a.details.length > 0) {
      return {
        category: cat,
        label: entry.label,
        score: a.sum,
        tone: interpretScore(a.sum),
        detail: a.details.join("；"),
        available: true,
      };
    }

    // 兜底：该维度当期无信号
    return {
      category: cat,
      label: entry.label,
      score: null,
      tone: null,
      detail: "当期无显著信号",
      available: false,
    };
  });
}
