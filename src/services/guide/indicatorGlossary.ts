/**
 * 指标通识词典 — 新手 SOP 向导的「人话翻译」数据层。
 *
 * 把决策引擎的 9 大信号维度（+ 同类排名，共 10 项，key 同 CAT_LABEL / SignalCategory）
 * 逐个翻译成：
 *  - label  中文名
 *  - plain  大白话：这个维度到底在衡量什么
 *  - bullPlain / bearPlain  偏多 / 偏空时分别意味着什么
 *  - thresholdNote  三档阈值说明
 *
 * 评分阈值沿用 signalEngine 贡献分区间（-10~+10，>=5 偏多、<=-5 偏空、否则中性），
 * 由 `interpretScore` 统一判定，供 Step 卡片三档配色与文案复用。
 *
 * 本文件为纯静态数据 + 纯函数，零运行时依赖，不触碰任何评分算法。
 *
 * @module services/guide/indicatorGlossary
 */

import type { SignalCategory } from "@/services/decision/types";

/** 三档语义：涨红跌绿、中性 */
export type ScoreTone = "up" | "down" | "neutral";

export interface IndicatorGlossaryEntry {
  /** SignalCategory 键（与 decisionEngine 的 CAT_LABEL 一一对应） */
  key: SignalCategory;
  /** 中文名 */
  label: string;
  /** 大白话：这个维度到底在衡量什么 */
  plain: string;
  /** 偏多时意味着什么（人话） */
  bullPlain: string;
  /** 偏空时意味着什么（人话） */
  bearPlain: string;
  /** 三档阈值说明 */
  thresholdNote: string;
}

/**
 * 九维信号 + 同类排名 的通识词典。
 * key 顺序即 SOP「逐个过」的展示顺序。
 */
export const INDICATOR_GLOSSARY: Record<SignalCategory, IndicatorGlossaryEntry> = {
  trend: {
    key: "trend",
    label: "趋势",
    plain:
      "看价格相对均线的位置：短期均线是否排在长期均线之上（多头排列），代表走势整体向上。这是权最重的一项。",
    bullPlain: "均线多头排列、价格稳站均线上方，说明这段趋势是向上的，顺势而为胜率更高。",
    bearPlain: "均线空头排列、价格压在均线下方，说明趋势向下，逆势抄底风险大。",
    thresholdNote: "趋势贡献分 ≥5 视为偏多，≤-5 视为偏空。",
  },
  macd: {
    key: "macd",
    label: "MACD",
    plain:
      "用快慢两条均线的差值判断动能转折：金叉（快线上穿慢线）常是上涨动能启动，死叉则反之。偏中短期节奏。",
    bullPlain: "MACD 金叉或红柱放大，说明上涨动能正在加强。",
    bearPlain: "MACD 死叉或绿柱放大，说明下跌动能正在加强。",
    thresholdNote: "MACD 贡献分 ≥5 视为偏多，≤-5 视为偏空。",
  },
  momentum: {
    key: "momentum",
    label: "动量",
    plain:
      "看涨速是否过快或过冷：RSI、KDJ、布林带等告诉你「是否已经涨疯了（超买）」或「是否已经跌透了（超卖）」。",
    bullPlain: "动量温和向上、尚未超买，说明还有上行空间，不是强弩之末。",
    bearPlain: "进入超买区意味着短期涨太猛易回落；持续超卖则反映疲弱。",
    thresholdNote: "动量贡献分 ≥5 视为偏多，≤-5 视为偏空。",
  },
  bias: {
    key: "bias",
    label: "乖离",
    plain:
      "衡量价格「离均线有多远」。偏离太大，就像橡皮筋拉太满，容易往回弹（修复）。是独立的风险维度。",
    bullPlain: "乖离温和为正，说明上涨有均线支撑，不算失控。",
    bearPlain: "正乖离过大提示短线过热、有回踩均线风险；负乖离过大则提示超跌。",
    thresholdNote: "乖离贡献分 ≥5 视为偏多，≤-5 视为偏空。",
  },
  volume: {
    key: "volume",
    label: "量能",
    plain:
      "看成交量是否配合价格：上涨放量代表资金真金白银进场，下跌缩量代表抛压轻。量价配合才健康。",
    bullPlain: "上涨伴随放量，说明买方力量扎实，不是虚涨。",
    bearPlain: "上涨缩量或下跌放量，说明资金不认同，反弹容易夭折。",
    thresholdNote: "量能贡献分 ≥5 视为偏多，≤-5 视为偏空。",
  },
  pattern: {
    key: "pattern",
    label: "形态",
    plain:
      "K 线图上反复出现的价格图形（如锤子线、吞没、缺口等），是市场情绪留下的「脚印」，新近出现的形态更值得关注。",
    bullPlain: "出现看涨形态，说明有资金在低位承接、尝试反攻。",
    bearPlain: "出现看跌形态，说明高位有资金兑现、抛压显现。",
    thresholdNote: "形态贡献分 ≥5 视为偏多，≤-5 视为偏空（来自 K 线形态检测）。",
  },
  navmom: {
    key: "navmom",
    label: "净值",
    plain:
      "仅「非 ETF 基金」使用：因为没有盘中实时 K 线，改用历史净值序列算自身涨跌动量，作为方向性依据。",
    bullPlain: "净值近段持续走高，自身趋势向上。",
    bearPlain: "净值近段持续走低，自身趋势向下。",
    thresholdNote: "净值动量 ≥5 视为偏多，≤-5 视为偏空（仅净值模式计入）。",
  },
  capitalflow: {
    key: "capitalflow",
    label: "资金面",
    plain:
      "东财增强因子：看这只基金重仓股 / 对应 ETF 的主力净流入、北向资金增持情况。代表「聪明钱」的动向（需接入东财数据源）。",
    bullPlain: "主力净流入、北向增持，说明大资金在买。",
    bearPlain: "主力净流出、北向减持，说明大资金在撤。",
    thresholdNote: "资金面因子偏离中性越多越偏多/偏空；未接入时显示「未接入」。",
  },
  sector: {
    key: "sector",
    label: "板块",
    plain:
      "东财增强因子：看基金所属赛道（如半导体、新能源）的整体强弱。板块风口上，个股/基金更容易被带动（需接入东财数据源）。",
    bullPlain: "所在板块整体走强，有行业 Beta 加持。",
    bearPlain: "所在板块整体走弱，行业拖累明显。",
    thresholdNote: "板块因子偏离中性越多越偏多/偏空；未接入时显示「未接入」。",
  },
  peer: {
    key: "peer",
    label: "排名",
    plain:
      "东财增强因子：看这只基金在同类中的排名百分位（前 10% 还是后 50%）。反映它相对同行的超额能力（需接入东财数据源）。",
    bullPlain: "同类排名靠前，说明它比大多数同行能打。",
    bearPlain: "同类排名靠后，说明它跑输多数同行。",
    thresholdNote: "排名百分位越高越偏多；未接入时显示「未接入」。",
  },
};

/** 九维 + 排名 的展示顺序（SOP「逐个过」即按此走） */
export const GLOSSARY_ORDER: SignalCategory[] = [
  "trend",
  "macd",
  "momentum",
  "bias",
  "volume",
  "pattern",
  "navmom",
  "capitalflow",
  "sector",
  "peer",
];

/** 三档语义 → 中文标签（供卡片展示） */
export const SCORE_TONE_LABEL: Record<ScoreTone, string> = {
  up: "偏多",
  down: "偏空",
  neutral: "中性",
};

/**
 * 统一三档判定：贡献分 [-10, +10]，
 * ≥5 偏多（up）、≤-5 偏空（down）、其余中性（neutral）。
 * 所有维度（含归一化后的东财 overlay）共用同一阈值，保证配色/文案一致。
 */
export function interpretScore(score: number): ScoreTone {
  if (score >= 5) return "up";
  if (score <= -5) return "down";
  return "neutral";
}

/**
 * 综合评分贡献 key（signalEngine 的 SignalWeights） → 决策维度（SignalCategory）映射。
 * 与 decisionEngine.collectScoreSignals 的 catOf 保持一致，
 * 供 StepSignals 把 signalResult.contributions 归并到九维展示。
 */
export const CONTRIB_CATEGORY_MAP: Record<string, SignalCategory> = {
  maTrend: "trend",
  macdCross: "macd",
  rsi: "momentum",
  bollinger: "momentum",
  klinePattern: "pattern",
  volume: "volume",
};
