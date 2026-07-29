/**
 * 统一决策引擎 — 融合 K线形态 / 技术指标 / 综合评分 / 命名策略
 *
 * 设计（借鉴 daily_stock_analysis 的算法决策结构）：
 *  1. 把四套来源归一化为 `AnalysisSignal`（方向 × 强度 × 置信度 × 新鲜度 × 类别）
 *  2. 分桶累加多头/空头有效功率 → 多空力量
 *  3. 按类别权重合成 0-100 综合评分（趋势 30 / 乖离 20 / 动量 15 / 量能 15 / MACD 10 / 形态 10；
 *     净值基金且 NAV 因子可用时动态加入 navmom 12；东财因子以 overlay 叠加层注入，不计入基础权重）
 *  4. 一致性(agreement)检测多空冲突；趋势背景(MA 排列)修正评级
 *  5. 产出买入理由 + 风险因子双列表 + 人话总结
 *
 * 纯函数，不修改既有 signalEngine / klinePatterns / stockSdkIndicators / strategyLayer。
 *
 * @module decision/decisionEngine
 */

import type { KLineData } from "@/types";
import type { DetectedPattern } from "../klinePatterns";
import type { SignalResult, SignalContribution } from "../signalEngine";
import type { StockSdkIndicatorsResult, SignalEvent } from "../stockSdkIndicators";
import type { StrategyHit } from "../strategyLayer";
import type {
  AnalysisSignal,
  Decision,
  DecisionAction,
  DecisionInputs,
  Direction,
  Rating,
  ReasonItem,
  SignalCategory,
  NavFactors,
  EmFactors,
  GuardrailReason,
  MarketRegime,
  SignalType,
} from "./types";
import { computeRiskProfile } from "./riskProfile";

// ─── 类别权重（基础维度；navmom 仅净值模式动态加入；overlay 类不计入基础权重） ───────────
const BASE_WEIGHT: Partial<Record<SignalCategory, number>> = {
  trend: 30,
  macd: 10,
  momentum: 15,
  bias: 20,
  volume: 15,
  pattern: 10,
  navmom: 12,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ─── 叠加层 / 折扣阈值（集中管理，便于调参） ───────────
/** 东财因子评分中性基准（0~100 中的 50） */
const EM_NEUTRAL = 50;
/** 资金面 / 板块 评分偏离中性 → 增量 的缩放系数 */
const EM_FACTOR_SCALE = 0.1;
/** 单个东财因子对综合评分的最大增量(±) */
const EM_FACTOR_CAP = 5;
/** 全部东财因子叠加后的总增量上限(±) */
const EM_TOTAL_CAP = 12;
/** 同类排名百分位 → 增量 的缩放分母 */
const EM_PEER_SCALE = 10;
/** 市场 regime 折扣：强度 → 折扣比例 的缩放系数与上限 */
const REGIME_DISC_SCALE = 0.5;
const REGIME_DISC_MAX = 0.5;
/** 多空冲突判定：弱势方 ≥ 强势方的此比例即视为分歧较大 */
const CONFLICT_MINORITY_RATIO = 0.4;

// ─── 收集器：把各来源归一化为 AnalysisSignal ───────────

/** K 线形态 → 信号（依据形态在 K 线序列中的新近度衰减） */
function collectPatternSignals(patterns: DetectedPattern[], klines: KLineData[]): AnalysisSignal[] {
  const n = klines.length;
  return patterns.map((p) => {
    const recency = Math.max(0, n - 1 - p.index);
    const freshness = clamp(1 - recency / 10, 0.3, 1);
    return {
      id: `pattern:${p.type}:${p.index}`,
      label: p.description,
      direction:
        p.direction === "bullish" ? "bull" : p.direction === "bearish" ? "bear" : "neutral",
      strength: p.confidence,
      confidence: p.confidence,
      freshness,
      category: "pattern",
      source: "K线形态",
      detail: p.description,
    };
  });
}

const EVENT_CATEGORY: Record<string, SignalCategory> = {
  ma_golden_cross: "trend",
  ma_death_cross: "trend",
  macd_golden_cross: "macd",
  macd_death_cross: "macd",
  kdj_golden_cross: "momentum",
  kdj_death_cross: "momentum",
  kdj_overbought: "momentum",
  kdj_oversold: "momentum",
  rsi_overbought: "momentum",
  rsi_oversold: "momentum",
  boll_break_upper: "momentum",
  boll_break_lower: "momentum",
  sar_reversal_up: "trend",
  sar_reversal_down: "trend",
};

/** 指标事件（calcSignals 产出，已按日期倒序） → 信号 */
function collectIndicatorEventSignals(
  signals: SignalEvent[],
  klines: KLineData[],
): AnalysisSignal[] {
  const dateIndex = new Map(klines.map((k, i) => [k.date, i]));
  const n = klines.length;
  return signals.map((s, rank) => {
    const idx = dateIndex.get(s.date);
    const recency = idx !== undefined ? Math.max(0, n - 1 - idx) : 0;
    const freshness = clamp(1 - recency / 12, 0.3, 1) * (1 - rank * 0.04);
    return {
      id: `ind:${s.type}:${s.date}`,
      label: s.label,
      direction: s.direction === "up" ? "bull" : s.direction === "down" ? "bear" : "neutral",
      strength: 0.7,
      confidence: 0.7,
      freshness: clamp(freshness, 0.2, 1),
      category: EVENT_CATEGORY[s.type] ?? "momentum",
      source: "技术指标",
      detail: s.label,
    };
  });
}

/** 指标快照读数（KDJ/WR/CCI/BIAS/SAR 当前状态） → 信号（含乖离独立风险维度） */
function collectIndicatorSnapshotSignals(ind: StockSdkIndicatorsResult): AnalysisSignal[] {
  const out: AnalysisSignal[] = [];
  const snap = ind.latest;
  if (snap.kdj?.k !== null && snap.kdj?.k !== undefined) {
    const k = snap.kdj.k;
    if (k > 80)
      out.push(
        mk("ind:kdj:overbought", `KDJ.K=${k.toFixed(1)} 超买`, "bear", 0.6, "momentum", "技术指标"),
      );
    else if (k < 20)
      out.push(
        mk("ind:kdj:oversold", `KDJ.K=${k.toFixed(1)} 超卖`, "bull", 0.6, "momentum", "技术指标"),
      );
  }
  if (snap.cci !== null && snap.cci !== undefined) {
    const c = snap.cci;
    if (c > 100)
      out.push(
        mk("ind:cci:overbought", `CCI=${c.toFixed(1)} 超买`, "bear", 0.55, "momentum", "技术指标"),
      );
    else if (c < -100)
      out.push(
        mk("ind:cci:oversold", `CCI=${c.toFixed(1)} 超卖`, "bull", 0.55, "momentum", "技术指标"),
      );
  }
  if (snap.sar?.trend === 1)
    out.push(mk("ind:sar:up", "SAR 多头趋势", "bull", 0.6, "trend", "技术指标"));
  else if (snap.sar?.trend === -1)
    out.push(mk("ind:sar:down", "SAR 空头趋势", "bear", 0.6, "trend", "技术指标"));
  // 乖离率：偏离均线过远 → 独立风险维度
  if (snap.bias) {
    for (const [key, val] of Object.entries(snap.bias)) {
      if (val === null || val === undefined) continue;
      if (val > 8)
        out.push(
          mk(
            `ind:bias:${key}`,
            `乖离${key}=${val.toFixed(1)}% 过高，严禁追高`,
            "bear",
            clamp(val / 20, 0.3, 0.9),
            "bias",
            "技术指标",
          ),
        );
      else if (val < -8)
        out.push(
          mk(
            `ind:bias:${key}`,
            `乖离${key}=${val.toFixed(1)}% 过低，存在修复空间`,
            "bull",
            clamp(-val / 20, 0.3, 0.9),
            "bias",
            "技术指标",
          ),
        );
    }
  }
  return out;
}

function mk(
  id: string,
  label: string,
  direction: Direction,
  strength: number,
  category: SignalCategory,
  source: string,
): AnalysisSignal {
  return {
    id,
    label,
    direction,
    strength,
    confidence: 0.7,
    freshness: 1,
    category,
    source,
    detail: label,
  };
}

/** 综合评分贡献 → 信号（描述"当前状态"，新鲜度=1） */
function collectScoreSignals(result: SignalResult): AnalysisSignal[] {
  const catOf: Record<string, SignalCategory> = {
    maTrend: "trend",
    macdCross: "macd",
    rsi: "momentum",
    bollinger: "momentum",
    klinePattern: "pattern",
    volume: "volume",
  };
  return result.contributions
    .filter((c: SignalContribution) => c.score !== 0)
    .map((c) => ({
      id: `score:${c.key}`,
      label: c.label,
      direction: (c.score > 0 ? "bull" : "bear") as Direction,
      strength: clamp(Math.abs(c.score) / 10, 0.1, 1),
      confidence: 0.7,
      freshness: 1,
      category: catOf[c.key] ?? "momentum",
      source: "综合评分",
      detail: c.detail,
    }));
}

/** 命名策略 → 信号 */
function collectStrategySignals(strategies: StrategyHit[]): AnalysisSignal[] {
  return strategies.map((s) => ({
    id: `strat:${s.id}`,
    label: s.name,
    direction: s.direction,
    strength: s.confidence,
    confidence: s.confidence,
    freshness: 1,
    category: s.category,
    source: "策略",
    detail: s.detail,
  }));
}

/** NAV 原生因子 → 信号（净值基金专属方向性依据；仅 momentum60 与深跌回撤给方向） */
function collectNavSignals(nav: NavFactors): AnalysisSignal[] {
  const out: AnalysisSignal[] = [];
  const add = (id: string, label: string, direction: Direction, strength: number) =>
    out.push({
      id,
      label,
      direction,
      strength,
      confidence: 0.6,
      freshness: 1,
      category: "navmom",
      source: "净值因子",
      detail: label,
    });

  if (nav.momentum60 != null) {
    if (nav.momentum60 > 8)
      add(
        "nav:mom60",
        `NAV 60日动量 +${nav.momentum60.toFixed(1)}%`,
        "bull",
        clamp(nav.momentum60 / 15, 0.2, 1),
      );
    else if (nav.momentum60 < -8)
      add(
        "nav:mom60",
        `NAV 60日动量 ${nav.momentum60.toFixed(1)}%`,
        "bear",
        clamp(-nav.momentum60 / 15, 0.2, 1),
      );
  }
  // 深跌区间（动量不强的修复阶段）给轻微偏空，避免误判为底部反转
  if (nav.maxDrawdown != null && nav.maxDrawdown < -20 && (nav.momentum60 ?? 0) > -8) {
    add(
      "nav:mdd",
      `NAV 最大回撤 ${nav.maxDrawdown.toFixed(1)}%`,
      "bear",
      clamp(-nav.maxDrawdown / 40, 0.2, 0.8),
    );
  }
  return out;
}

/** 东财交叉截面因子 → 信号（仅用于理由展示；基础加权在融合循环中跳过，叠加层另行注入评分） */
function collectEmSignals(em: EmFactors): AnalysisSignal[] {
  const out: AnalysisSignal[] = [];
  if (em.capitalFlow.available && em.capitalFlow.combinedScore != null) {
    const s = em.capitalFlow.combinedScore;
    const dir: Direction = s >= 55 ? "bull" : s <= 45 ? "bear" : "neutral";
    out.push({
      id: "em:capital",
      label: `资金面分 ${s.toFixed(0)}`,
      direction: dir,
      strength: clamp(Math.abs(s - EM_NEUTRAL) / EM_NEUTRAL, 0.2, 1),
      confidence: 0.6,
      freshness: 1,
      category: "capitalflow",
      source: "东财资金面",
      detail: `主力净流入/北向增持综合分 ${s.toFixed(0)}/100`,
    });
  }
  if (em.sector.available && em.sector.combinedScore != null) {
    const s = em.sector.combinedScore;
    const dir: Direction = s >= 55 ? "bull" : s <= 45 ? "bear" : "neutral";
    out.push({
      id: "em:sector",
      label: `板块赛道分 ${s.toFixed(0)}`,
      direction: dir,
      strength: clamp(Math.abs(s - EM_NEUTRAL) / EM_NEUTRAL, 0.2, 1),
      confidence: 0.6,
      freshness: 1,
      category: "sector",
      source: "东财板块",
      detail: `行业/概念板块加权强度分 ${s.toFixed(0)}/100`,
    });
  }
  if (em.peerRank.available && em.peerRank.percentile != null) {
    const p = em.peerRank.percentile;
    const dir: Direction = p <= 40 ? "bull" : p >= 60 ? "bear" : "neutral";
    out.push({
      id: "em:peer",
      label: `同类排名前 ${p.toFixed(0)}%`,
      direction: dir,
      strength: clamp(Math.abs(EM_NEUTRAL - p) / EM_NEUTRAL, 0.2, 1),
      confidence: 0.6,
      freshness: 1,
      category: "peer",
      source: "东财同类排名",
      detail: `同类近三月排名百分位 ${p.toFixed(1)}%（越小越好）`,
    });
  }
  return out;
}

// ─── 融合 ─────────────────────────────────────────

const RATING_META: Record<Rating, { label: string; color: "up" | "down" | "neutral" }> = {
  strong_buy: { label: "强烈买入", color: "up" },
  buy: { label: "买入", color: "up" },
  hold: { label: "持有 / 观望", color: "neutral" },
  reduce: { label: "减仓 / 观望", color: "down" },
  sell: { label: "卖出", color: "down" },
  strong_sell: { label: "强烈卖出", color: "down" },
};

/** 八态 action 元信息（涨红跌绿 / 中性 / 观察 / 回避） */
export const ACTION_META: Record<
  DecisionAction,
  { label: string; color: "up" | "down" | "neutral" }
> = {
  buy: { label: "买入", color: "up" },
  add: { label: "加仓", color: "up" },
  hold: { label: "持有", color: "neutral" },
  watch: { label: "观察", color: "neutral" },
  reduce: { label: "减仓", color: "down" },
  sell: { label: "卖出", color: "down" },
  avoid: { label: "回避", color: "down" },
  alert: { label: "预警", color: "neutral" },
};

/** 评分 ↔ 八态 action 校准（80/60/45/30 四档；watch/avoid/alert 由护栏/特殊态产生） */
export function scoreToRawAction(score: number): DecisionAction {
  if (score >= 80) return "buy";
  if (score >= 60) return "add";
  if (score >= 45) return "hold";
  if (score >= 30) return "reduce";
  return "sell";
}

/**
 * 护栏：基于数据质量 / 上下文，把原始动作降级（数据降级 → 决策降级 + 显式原因）。
 * 确定性、可解释；每条触发都附带中文原因（含中性动作的显式理由）。
 */
export function applyGuardrails(
  raw: DecisionAction,
  ctx: {
    lowConfidence: boolean;
    conflict: boolean;
    trendBearish: boolean;
    regime?: MarketRegime;
    regimeAdjusted: boolean;
    hasKline: boolean;
  },
): { action: DecisionAction; reasons: GuardrailReason[] } {
  const reasons: GuardrailReason[] = [];
  // 无 K 线 → 无法决策，直接回避
  if (!ctx.hasKline) {
    return {
      action: "avoid",
      reasons: [
        {
          kind: "data_missing",
          description: "无可用行情 / K 线数据，无法形成可靠决策，建议补充数据后重试",
        },
      ],
    };
  }
  let action = raw;
  // 1. 多空冲突：偏多侧降级为观察，避免误判
  if (ctx.conflict && (action === "buy" || action === "add")) {
    action = "watch";
    reasons.push({
      kind: "conflict",
      description: "多空信号显著分歧，结论可靠性下降，降级为「观察」",
    });
  }
  // 2. 空头趋势：不追高，偏多侧降一档
  if (ctx.trendBearish && (action === "buy" || action === "add")) {
    action = action === "buy" ? "add" : "hold";
    reasons.push({
      kind: "trend_bearish",
      description: "处于空头排列趋势，反弹空间受限，不宜追高",
    });
  }
  // 3. 低置信（净值模式）：偏多动一档 / 中性转观察
  if (ctx.lowConfidence && (action === "buy" || action === "add" || action === "hold")) {
    action = action === "buy" ? "add" : action === "add" ? "hold" : "watch";
    reasons.push({
      kind: "low_confidence",
      description: "基于净值走势（无盘中区间），指标置信度较低，建议切换 ETF 真实 K 线复核",
    });
  }
  // 4. 市场 regime 折扣（与引擎 discount 对齐）：空头市对乐观打折、多头市对悲观打折
  if (ctx.regimeAdjusted && ctx.regime) {
    if (ctx.regime.trend === "bear" && (action === "buy" || action === "add")) {
      action = action === "buy" ? "add" : "hold";
      reasons.push({ kind: "regime", description: "空头市环境下对乐观信号打折，下调一档" });
    } else if (ctx.regime.trend === "bull" && (action === "reduce" || action === "sell")) {
      action = action === "sell" ? "reduce" : "hold";
      reasons.push({ kind: "regime", description: "多头市环境下对悲观信号打折，上调一档" });
    }
  }
  return { action, reasons };
}

/**
 * 中期趋势（近三月）：用区间收益符号 + 中期均线排列判定下行。
 * 下行 = 区间收益 < 0 且 未出现中期多头排列（MA20 ≥ MA60）。
 * 纯计算、零网络，无需新接口。
 */
function computeMediumTermTrend(klines: KLineData[]): { down: boolean; returnPct: number } {
  if (klines.length < 2) return { down: false, returnPct: 0 };
  const first = klines[0].close;
  const last = klines[klines.length - 1].close;
  const returnPct = ((last - first) / first) * 100;
  const closes = klines.map((k) => k.close);
  const ma = (n: number) => {
    if (closes.length < n) return null;
    let s = 0;
    for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
    return s / n;
  };
  const ma20 = ma(Math.min(20, closes.length));
  const ma60 = ma(Math.min(60, closes.length));
  // 中期多头排列（MA20 ≥ MA60）视为上行结构；否则若收益为负则判定下行
  const bullAlign = ma20 != null && ma60 != null && ma20 >= ma60;
  return { down: returnPct < 0 && !bullAlign, returnPct };
}

/**
 * 超卖反弹判定：仅在中期下行背景下成立。
 * 反弹 = 历史超卖（KDJ/RSI 超卖事件）后出现金叉（KDJ/MACD 金叉 / SAR 反转上 / 布林上破），
 * 或 当前仍处超卖（KDJ.K<25）且有近期金叉。用于把「接飞刀」标注为 reversion 而非趋势买入。
 * `ind.signals` 已按日期倒序（最新在前）。
 */
function hasOversoldSignal(ind: StockSdkIndicatorsResult, midTermDown: boolean): boolean {
  if (!midTermDown) return false;
  const sigs = ind.signals;
  const isOversold = (t: string) => t === "kdj_oversold" || t === "rsi_oversold";
  const isBullCross = (t: string) =>
    t === "kdj_golden_cross" ||
    t === "macd_golden_cross" ||
    t === "sar_reversal_up" ||
    t === "boll_break_upper";
  const recent = sigs.slice(0, 15);
  let oversoldIdx = -1;
  let bullCrossIdx = -1;
  for (let i = 0; i < recent.length; i++) {
    if (oversoldIdx < 0 && isOversold(recent[i].type)) oversoldIdx = i;
    if (bullCrossIdx < 0 && isBullCross(recent[i].type)) bullCrossIdx = i;
  }
  // 反弹：先超卖、后金叉（金叉在倒序数组中更靠前 / 更近期）
  const rebound = oversoldIdx >= 0 && bullCrossIdx >= 0 && bullCrossIdx < oversoldIdx;
  // 当前仍超卖且近期有金叉 → 反弹修复背景
  const currentOversold = ind.latest.kdj?.k != null && ind.latest.kdj.k < 25;
  const recentBullCross = bullCrossIdx >= 0 && bullCrossIdx <= 6;
  return rebound || (currentOversold && recentBullCross);
}

/** 评级多空序；用于「诚实对齐」——取两者中较保守者，避免动作与评级矛盾 */
const RATING_ORDER: Record<Rating, number> = {
  strong_buy: 5,
  buy: 4,
  hold: 3,
  reduce: 2,
  sell: 1,
  strong_sell: 0,
};
/** 各动作允许的最高评级（避免动作被低估后又被评级「虚高」） */
const ACTION_MAX_RATING: Record<DecisionAction, Rating> = {
  buy: "strong_buy",
  add: "buy",
  hold: "hold",
  watch: "hold",
  reduce: "reduce",
  sell: "sell",
  avoid: "hold",
  alert: "hold",
};
function minRating(a: Rating, b: Rating): Rating {
  return RATING_ORDER[a] <= RATING_ORDER[b] ? a : b;
}

/**
 * 融合四套分析为单一决策建议。
 */
export function buildDecision(inputs: DecisionInputs): Decision {
  const { klines, patterns, signalResult, ind, strategies, lowConfidence, nav, regime, em } =
    inputs;

  const signals: AnalysisSignal[] = [
    ...collectPatternSignals(patterns, klines),
    ...collectIndicatorEventSignals(ind.signals, klines),
    ...collectIndicatorSnapshotSignals(ind),
    ...(signalResult ? collectScoreSignals(signalResult) : []),
    ...collectStrategySignals(strategies),
    ...(nav?.available ? collectNavSignals(nav) : []),
    ...(em ? collectEmSignals(em) : []),
  ];

  // 动态权重：净值模式且 NAV 因子可用时才计入 navmom，避免改变 ETF 基金基线评分
  const weights: Partial<Record<SignalCategory, number>> = { ...BASE_WEIGHT };
  if (!nav?.available) delete weights.navmom;
  const TOTAL_WEIGHT = Object.values(weights).reduce((a, b) => a + b, 0);

  // 分维度带权累加（有效功率 = 方向 × 强度 × 置信度 × 新鲜度）
  const axisNet: Record<string, number> = {
    trend: 0,
    macd: 0,
    momentum: 0,
    bias: 0,
    volume: 0,
    pattern: 0,
    navmom: 0,
  };
  let bullPower = 0;
  let bearPower = 0;

  for (const s of signals) {
    if (s.direction === "neutral") continue;
    const w = weights[s.category];
    if (w == null) continue; // em 等 overlay 类不计入基础加权，仅用于理由展示
    const sign = s.direction === "bull" ? 1 : -1;
    const eff = sign * s.strength * s.confidence * s.freshness;
    axisNet[s.category] += eff;
    const weighted = Math.abs(eff) * w;
    if (sign > 0) bullPower += weighted;
    else bearPower += weighted;
  }

  // 0-100 综合评分（每维度先夹到 [-1,1] 再按权重合成）
  let scoreRaw = 0;
  for (const cat of Object.keys(axisNet)) {
    const w = weights[cat as SignalCategory];
    if (w == null) continue;
    scoreRaw += w * clamp(axisNet[cat], -1, 1);
  }
  let score = Math.round(50 + 50 * (scoreRaw / TOTAL_WEIGHT));
  score = clamp(score, 0, 100);
  // 校准基准：折扣前纯分（置信压缩 / 东财叠加 / regime 折扣之前）
  const rawScore = score;

  const total = bullPower + bearPower;
  const bullRatio = total > 0 ? bullPower / total : 0.5;
  // 冲突：多空力量相当（弱势一方 ≥ 强势方的此比例即视为分歧较大）
  const conflict =
    total > 0 &&
    Math.min(bullPower, bearPower) >= CONFLICT_MINORITY_RATIO * Math.max(bullPower, bearPower);

  // 趋势背景：空头排列 → 修正评级（不追高）
  let trendBearish = false;
  const maContrib = signalResult?.contributions.find((c) => c.key === "maTrend");
  if (maContrib && maContrib.score < -3) trendBearish = true;
  if (ind.signals.some((s) => s.type === "ma_death_cross" || s.type === "macd_death_cross"))
    trendBearish = true;
  if (ind.latest.sar?.trend === -1) trendBearish = true;

  // 净值模式置信度降级：评分向 50 收敛；有 NAV 因子依据时软化压缩（×0.9），否则 ×0.7
  const isLowConf = lowConfidence ?? !ind.ohlcAvailable;
  const compFactor = isLowConf ? (nav?.available ? 0.9 : 0.7) : 1;
  if (isLowConf) score = Math.round(50 + (score - 50) * compFactor);

  // 东财叠加层（overlay）：仅 available 因子产生有界增量；不可用时增量恒为 0，不影响评分。
  // ⚠️ 与 T1 硬护栏（capital_divergence / sector_headwind）的「去重」说明（PLAN §5 T2.2 评估结论）：
  //   - 二者**同源**复用 em 的 capitalFlow / sector 同一份分，但输出维度正交、非有害双重计数：
  //       · 本软叠加只微调「展示评分 + 评级幅度」（有界 ±12），且经 L763 诚实对齐后被 finalAction 封顶；
  //       · T1 硬护栏改的是「八态动作天花板」（buy→watch/hold），强制在不同维度生效。
  //   - 同向时两者一致强化（em 偏空 → 既压低展示分又封顶动作，正确）；em 偏多时仅本叠加轻微确认（预期行为）。
  //   - 因此**保留两者**，勿以「避免双重计数」为由删除本块——删除会丢失展示分的渐进调节能力。
  let emDelta = 0;
  if (em?.capitalFlow.available && em.capitalFlow.combinedScore != null) {
    emDelta += clamp(
      (em.capitalFlow.combinedScore - EM_NEUTRAL) * EM_FACTOR_SCALE,
      -EM_FACTOR_CAP,
      EM_FACTOR_CAP,
    );
  }
  if (em?.sector.available && em.sector.combinedScore != null) {
    emDelta += clamp(
      (em.sector.combinedScore - EM_NEUTRAL) * EM_FACTOR_SCALE,
      -EM_FACTOR_CAP,
      EM_FACTOR_CAP,
    );
  }
  if (em?.peerRank.available && em.peerRank.percentile != null) {
    emDelta += clamp(
      (EM_NEUTRAL - em.peerRank.percentile) / EM_PEER_SCALE,
      -EM_FACTOR_CAP,
      EM_FACTOR_CAP,
    );
  }
  emDelta = clamp(emDelta, -EM_TOTAL_CAP, EM_TOTAL_CAP);
  score = Math.round(score + emDelta);

  // 市场 regime 折扣：剥离 beta 伪信号（空头市对多头乐观度打折，多头市对悲观度打折）
  const regimeAdjusted = regime != null && regime.trend !== "neutral" && regime.strength > 0;
  if (regimeAdjusted) {
    const disc = clamp(regime!.strength * REGIME_DISC_SCALE, 0, REGIME_DISC_MAX);
    const dev = score - 50;
    if (regime!.trend === "bear" && dev > 0) score = Math.round(50 + dev * (1 - disc));
    else if (regime!.trend === "bull" && dev < 0) score = Math.round(50 + dev * (1 - disc));
  }
  score = clamp(score, 0, 100);

  // 评级：先按分数，再叠加「趋势背景 / 多空冲突」上下文修正
  let rating: Rating;
  if (trendBearish || conflict) {
    // 风险上下文：不追高、偏防守；但强多头共振（高分且多方主导）仍给出买入信号，避免引擎永不买入。
    // 阈值较原 score>=70 && bullRatio>=0.6 适度放宽（-> score>=65 && bullRatio>=0.55），
    // 否则偏空/震荡市中引擎几乎永不买入，回测买入侧覆盖度为 0，无法验证买入逻辑。
    if (score >= 65 && bullRatio >= 0.55) rating = "buy";
    else if (score >= 60) rating = "hold";
    else if (score >= 45) rating = "reduce";
    else if (score >= 30) rating = "sell";
    else rating = "strong_sell";
  } else {
    if (score >= 75 && bullRatio >= 0.6) rating = "strong_buy";
    else if (score >= 60) rating = "buy";
    else if (score >= 45) rating = "hold";
    else if (score >= 30) rating = "reduce";
    else rating = "sell";
  }

  // 理由：按有效功率排序取 top
  const ranked = signals
    .filter((s) => s.direction !== "neutral")
    .map((s) => ({
      s,
      w: (s.direction === "bull" ? 1 : -1) * s.strength * s.confidence * s.freshness,
    }));
  const bulls = ranked
    .filter((r) => r.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4);
  const bears = ranked
    .filter((r) => r.w < 0)
    .map((r) => ({ s: r.s, w: -r.w }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 4);
  const toReason = (r: { s: AnalysisSignal; w: number }): ReasonItem => ({
    label: r.s.label,
    detail: r.s.detail ?? r.s.label,
    category: r.s.category,
    weight: r.w,
  });
  const bullReasons = bulls.map(toReason);
  const bearReasons = bears.map(toReason);

  // 八态 action 校准 + 基础护栏（数据降级 → 决策降级 + 显式原因）
  const rawAction = scoreToRawAction(rawScore);
  const { action: rawFinal, reasons: guardrails } = applyGuardrails(rawAction, {
    lowConfidence: isLowConf,
    conflict,
    trendBearish,
    regime,
    regimeAdjusted,
    hasKline: klines.length > 0,
  });
  let finalAction = rawFinal;

  // ─── T1 上下文护栏（核心护栏 + 反弹语义标注）───
  // 中期趋势门控（纯计算，3 月收益符号 + 中期均线金叉）
  const { down: midTermDown, returnPct: midTermReturnPct } = computeMediumTermTrend(klines);

  // 1. 中期趋势门控：下行则动作上限封顶 add（即便短期动量翻多，也不给买入）
  if (midTermDown && (finalAction === "buy" || finalAction === "add")) {
    if (finalAction === "buy") {
      finalAction = "add";
      guardrails.push({
        kind: "mid_term_down",
        description: `中期趋势仍处下行（近三月区间收益 ${midTermReturnPct.toFixed(1)}%），动作上限封顶为加仓，不宜追高`,
      });
    }
  }

  // 2. 资金背离护栏：复用 em 叠加层已取的资金面分（避免重复取数）。技术偏多 + 资金分<50 → 降级观察/持有
  if (
    em?.capitalFlow.available &&
    em.capitalFlow.combinedScore != null &&
    em.capitalFlow.combinedScore < 50
  ) {
    const techBull =
      finalAction === "buy" || finalAction === "add" || rating === "buy" || rating === "strong_buy";
    if (techBull) {
      const before = finalAction;
      finalAction = finalAction === "buy" ? "watch" : "hold";
      if (finalAction !== before) {
        guardrails.push({
          kind: "capital_divergence",
          description: `技术面偏多但资金面分仅 ${em.capitalFlow.combinedScore!.toFixed(0)}（< 50），存在「价弹钱不跟」背离，降级为观察/持有`,
        });
      }
    }
  }

  // 3. 板块逆风护栏：复用 em 板块分。技术偏多 + 板块分<40（逆板块孤涨）→ 降级观察/持有
  if (em?.sector.available && em.sector.combinedScore != null && em.sector.combinedScore < 40) {
    const techBull =
      finalAction === "buy" || finalAction === "add" || rating === "buy" || rating === "strong_buy";
    if (techBull) {
      const before = finalAction;
      finalAction = finalAction === "buy" ? "watch" : "hold";
      if (finalAction !== before) {
        guardrails.push({
          kind: "sector_headwind",
          description: `技术面偏多但板块强度分仅 ${em.sector.combinedScore!.toFixed(0)}（< 40），逆板块孤涨，降级为观察/持有`,
        });
      }
    }
  }

  // 4. 反弹语义标注：短翻多（超卖修复 + 金叉）+ 中期下行 → reversion，评级上限持有
  const reversion = hasOversoldSignal(ind, midTermDown);
  const signalType: SignalType = reversion ? "reversion" : "trend";
  if (reversion && (finalAction === "buy" || finalAction === "add")) {
    finalAction = "hold";
    guardrails.push({
      kind: "reversion_label",
      description: "短期超卖反弹（非趋势确认），评级上限持有，不宜作为趋势买入信号",
    });
  }

  // 诚实对齐：rating 跟随 finalAction，避免「动作=观察 但 评级=买入」的表里不一
  rating = minRating(rating, ACTION_MAX_RATING[finalAction]);

  const summary = buildSummary(
    rating,
    conflict,
    trendBearish,
    bullReasons,
    bearReasons,
    isLowConf,
    signalType,
    midTermDown,
    midTermReturnPct,
  );

  return {
    rating,
    ratingLabel: RATING_META[rating].label,
    ratingColor: RATING_META[rating].color,
    score,
    rawScore,
    adjustedScore: score,
    rawAction,
    finalAction,
    actionLabel: ACTION_META[finalAction].label,
    actionColor: ACTION_META[finalAction].color,
    guardrails,
    bullPower,
    bearPower,
    bullRatio,
    agreement: bullRatio,
    conflict,
    lowConfidence: isLowConf,
    bullReasons,
    bearReasons,
    strategies,
    trendBearish,
    signalType,
    midTermDown,
    midTermReturnPct,
    summary,
    emDelta: Number(emDelta.toFixed(1)),
    regimeAdjusted,
    navAvailable: nav?.available ?? false,
    // 波动 / 仓位风险画像（只读参考）：纯计算，不改变任何动作 / 评分 / 评级。
    riskProfile: computeRiskProfile(klines, ind),
  };
}

function buildSummary(
  rating: Rating,
  conflict: boolean,
  trendBearish: boolean,
  bulls: ReasonItem[],
  bears: ReasonItem[],
  lowConf: boolean,
  signalType?: SignalType,
  midTermDown?: boolean,
  midTermReturnPct?: number,
): string {
  const parts: string[] = [];
  if (conflict) {
    const b = bulls[0]?.label ?? "多方信号";
    const r = bears[0]?.label ?? "空方信号";
    parts.push(`多空分歧较大：${b}（看多），但 ${r}（看空），信号可靠性下降`);
  }
  if (trendBearish && (rating === "hold" || rating === "reduce")) {
    parts.push("当前处于空头排列趋势背景下，反弹力度受限");
  }
  if (midTermDown) {
    parts.push(
      `中期趋势仍处下行（近三月区间收益 ${
        midTermReturnPct != null ? midTermReturnPct.toFixed(1) : ""
      }%），反弹空间取决于资金与板块配合`,
    );
  }
  if (signalType === "reversion") {
    parts.push("当前为短期超卖反弹而非趋势确认，不宜作为趋势买入信号，建议以观察 / 轻仓为主");
  }
  if (rating === "strong_buy" || rating === "buy") {
    parts.push(
      `综合看多，主要支撑：${
        bulls
          .slice(0, 2)
          .map((x) => x.label)
          .join("、") || "多指标共振"
      }`,
    );
  } else if (rating === "sell" || rating === "strong_sell") {
    parts.push(
      `综合看空，主要压力：${
        bears
          .slice(0, 2)
          .map((x) => x.label)
          .join("、") || "多指标转弱"
      }`,
    );
  } else {
    parts.push("方向尚不明朗，建议持有观望、不追高不杀跌");
  }
  if (lowConf)
    parts.push("（基于净值走势，无盘中区间，指标置信度较低，建议切换 ETF 真实 K 线复核）");
  return parts.join("；") + "。";
}
