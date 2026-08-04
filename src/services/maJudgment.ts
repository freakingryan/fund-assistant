/**
 * 均线研判（MA Judgment）— 纯本地计算，零网络
 *
 * 对场内 ETF / 个股的日线，计算代表性 X 日线（20/60/120/250）的：
 *   - 均线值、现价距均线的百分比
 *   - 连续「站上 / 跌破」天数（默认 N=3 日确认，过滤单日假突破）
 *   - 状态：站稳 / 跌破 / 站上未确认 / 跌破未确认 / 缠绕 / 数据不足
 *   - 对应买卖建议文案（加仓/入场 vs 止盈/减仓/清仓）
 *   - 综合姿态（strong_bull / bull / neutral / bear / strong_bear）
 *
 * 设计要点：
 *   - 函数周期无关：输入是「日线」即算日线均线；若日后喂周线即算周线均线。
 *   - 不依赖任何外部数据源，所有判断基于收盘价序列。
 *   - 仅输出建议，不自动下单 / 不发通知。
 *
 * @module maJudgment
 */

import type { KLineData } from "@/types";

// ─── 配置 ─────────────────────────────────────

/** 连续站上/跌破多少日才算「确认」（过滤单日假突破） */
export const CONFIRM_DAYS = 3;

export type MaRole = "short" | "mid" | "long" | "anchor";

export interface MaLineConfig {
  period: number;
  label: string;
  role: MaRole;
  /** 站稳（连续 N 日收盘 ≥ MA）时的建议 */
  holdAdvice: string;
  /** 跌破（连续 N 日收盘 ≤ MA）时的建议 */
  breakAdvice: string;
}

/** 代表性 X 日线：月/季/半年/年线，覆盖短中长三档 */
export const MA_LINES: MaLineConfig[] = [
  {
    period: 20,
    label: "20日线",
    role: "short",
    holdAdvice: "短线趋势向好，可逢回踩加仓 / 分批入场",
    breakAdvice: "短线转弱，建议止盈减仓",
  },
  {
    period: 60,
    label: "60日线",
    role: "mid",
    holdAdvice: "中线趋势向上，以持有为主",
    breakAdvice: "中线走弱，建议减仓避险",
  },
  {
    period: 120,
    label: "120日线",
    role: "long",
    holdAdvice: "中期多头排列，趋势持仓",
    breakAdvice: "中期转空，警惕进一步下行",
  },
  {
    period: 250,
    label: "250日线",
    role: "anchor",
    holdAdvice: "长期牛市格局，长线坚定持有",
    breakAdvice: "长期趋势破位，考虑清仓离场",
  },
];

// ─── 状态类型 ─────────────────────────────────

export type MaStatus =
  | "hold" // 连续 N 日站稳（收盘 ≥ MA）
  | "break" // 连续 N 日跌破（收盘 ≤ MA）
  | "above_unconfirmed" // 站上但不足 N 日
  | "below_unconfirmed" // 跌破但不足 N 日
  | "neutral" // 缠绕 / 方向不明
  | "insufficient"; // 数据不足（K 线少于周期）

export type MaDirection = "up" | "down" | "neutral";

export type MaPosture =
  "strong_bull" | "bull" | "neutral" | "bear" | "strong_bear" | "insufficient";

export interface MaJudgment {
  period: number;
  label: string;
  role: MaRole;
  maValue: number | null;
  close: number | null;
  /** 现价是否在均线上方（null = 无数据） */
  above: boolean | null;
  /** (现价 - MA) / MA * 100，百分比 */
  distancePct: number | null;
  /** 连续站上为正、连续跌破为负（绝对值 = 连续天数） */
  streak: number;
  status: MaStatus;
  statusLabel: string;
  advice: string;
  direction: MaDirection;
}

export interface MaJudgmentResult {
  ohlcAvailable: boolean;
  judgments: MaJudgment[];
  posture: MaPosture;
  postureLabel: string;
  summary: string;
}

// ─── 计算工具 ─────────────────────────────────

/** 简单移动平均（与 technicalIndicators.simpleMA 同义，这里独立避免耦合） */
function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[i - j];
      out.push(sum / period);
    }
  }
  return out;
}

/** 计算从末尾向前、与最后一根同侧（均线上方或下方）的连续天数 */
function trailingStreak(
  closes: number[],
  ma: (number | null)[],
): { lastSide: 1 | -1; streak: number } {
  const last = closes.length - 1;
  const maLast = ma[last];
  if (maLast == null) return { lastSide: 1, streak: 0 };
  const lastSide: 1 | -1 = closes[last] >= maLast ? 1 : -1;
  let streak = 0;
  for (let i = last; i >= 0; i--) {
    const m = ma[i];
    if (m == null) break;
    const side: 1 | -1 = closes[i] >= m ? 1 : -1;
    if (side === lastSide) streak++;
    else break;
  }
  return { lastSide, streak };
}

function describe(
  cfg: MaLineConfig,
  status: MaStatus,
  streak: number,
  confirmDays: number,
): { statusLabel: string; advice: string; direction: MaDirection } {
  switch (status) {
    case "hold":
      return {
        statusLabel: `站稳(${streak}日)`,
        advice: cfg.holdAdvice,
        direction: "up",
      };
    case "break":
      return {
        statusLabel: `跌破(${streak}日)`,
        advice: cfg.breakAdvice,
        direction: "down",
      };
    case "above_unconfirmed":
      return {
        statusLabel: `站上未确认(${streak}/${confirmDays}日)`,
        advice: `已站上${cfg.label}，但仅 ${streak} 日、未满 ${confirmDays} 日确认，建议等待回踩不破再加仓`,
        direction: "up",
      };
    case "below_unconfirmed":
      return {
        statusLabel: `跌破未确认(${Math.abs(streak)}/${confirmDays}日)`,
        advice: `已跌破${cfg.label}，观察 ${confirmDays} 日内能否收回，未收回则按「跌破」处理`,
        direction: "down",
      };
    case "neutral":
      return {
        statusLabel: "缠绕",
        advice: "现价在均线附近反复，方向不明，建议观望",
        direction: "neutral",
      };
    case "insufficient":
    default:
      return {
        statusLabel: "数据不足",
        advice: `需 ≥ ${cfg.period} 根日线才能计算${cfg.label}`,
        direction: "neutral",
      };
  }
}

function computePosture(judgments: MaJudgment[]): {
  posture: MaPosture;
  postureLabel: string;
  summary: string;
} {
  const valid = judgments.filter((j) => j.status !== "insufficient");
  if (valid.length === 0) {
    return { posture: "insufficient", postureLabel: "数据不足", summary: "暂无足够日线数据" };
  }

  const holds = valid.filter((j) => j.status === "hold").length;
  const breaks = valid.filter((j) => j.status === "break").length;
  const aboveLabels = valid.filter((j) => j.above === true).map((j) => j.label);
  const belowLabels = valid.filter((j) => j.above === false).map((j) => j.label);
  const close = valid[0].close;

  let posture: MaPosture;
  let postureLabel: string;
  if (holds === valid.length) {
    posture = "strong_bull";
    postureLabel = "全面站稳 · 多头排列";
  } else if (breaks === valid.length) {
    posture = "strong_bear";
    postureLabel = "全面跌破 · 空头排列";
  } else if (holds >= 3 && holds > breaks) {
    posture = "bull";
    postureLabel = "多数均线站稳 · 偏多";
  } else if (breaks >= 3 && breaks > holds) {
    posture = "bear";
    postureLabel = "多数均线跌破 · 偏空";
  } else {
    posture = "neutral";
    postureLabel = "多空交织 · 震荡";
  }

  const summary =
    `现价 ${close == null ? "—" : close.toFixed(2)}：` +
    `站上 ${aboveLabels.join("/") || "无"}，` +
    `跌破 ${belowLabels.join("/") || "无"}。${postureLabel}。`;

  return { posture, postureLabel, summary };
}

// ─── 主入口 ───────────────────────────────────

/**
 * 对日线序列做均线研判。
 * @param klines 按日期升序的 K 线（close 必须有效）
 * @param confirmDays 连续确认天数，默认 3
 */
export function judgeMaLines(
  klines: KLineData[],
  confirmDays: number = CONFIRM_DAYS,
): MaJudgmentResult {
  if (!klines || klines.length === 0) {
    return {
      ohlcAvailable: false,
      judgments: [],
      posture: "insufficient",
      postureLabel: "数据不足",
      summary: "暂无 K 线数据",
    };
  }

  const closes = klines.map((k) => k.close);
  const ohlcAvailable = klines.some((k) => k.high > k.low);
  const lastClose = closes[closes.length - 1];

  const judgments: MaJudgment[] = MA_LINES.map((cfg) => {
    const ma = sma(closes, cfg.period);
    const maLast = ma[ma.length - 1];

    if (maLast == null || lastClose == null) {
      const { statusLabel, advice, direction } = describe(cfg, "insufficient", 0, confirmDays);
      return {
        period: cfg.period,
        label: cfg.label,
        role: cfg.role,
        maValue: null,
        close: lastClose,
        above: null,
        distancePct: null,
        streak: 0,
        status: "insufficient",
        statusLabel,
        advice,
        direction,
      };
    }

    const above = lastClose > maLast;
    const distancePct = ((lastClose - maLast) / maLast) * 100;
    const { lastSide, streak } = trailingStreak(closes, ma);

    let status: MaStatus;
    if (lastSide === 1 && streak >= confirmDays) status = "hold";
    else if (lastSide === -1 && streak >= confirmDays) status = "break";
    else if (lastSide === 1) status = "above_unconfirmed";
    else if (lastSide === -1) status = "below_unconfirmed";
    else status = "neutral";

    const { statusLabel, advice, direction } = describe(cfg, status, streak, confirmDays);

    return {
      period: cfg.period,
      label: cfg.label,
      role: cfg.role,
      maValue: maLast,
      close: lastClose,
      above,
      distancePct,
      streak,
      status,
      statusLabel,
      advice,
      direction,
    };
  });

  const posture = computePosture(judgments);

  return {
    ohlcAvailable,
    judgments,
    posture: posture.posture,
    postureLabel: posture.postureLabel,
    summary: posture.summary,
  };
}
