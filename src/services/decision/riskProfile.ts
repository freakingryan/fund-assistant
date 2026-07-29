/**
 * 波动 / 仓位风险画像（纯只读信息字段）
 *
 * 仅基于本地 K 线 + stock-sdk 已算指标（ATR）做纯计算，零网络、零副作用。
 * 本模块**不修改**评分 / 评级 / 八态动作 —— 输出仅作为「建议参考」挂在 Decision.riskProfile，
 * 由卡片以只读面板呈现（如「建议最大仓位」「止损参考」），绝不影响决策动作。
 *
 * 设计原则（对应 PLAN-decision-optimization §5 T2.1）：只读字段，即便不改动作也实用；
 * 与 T1 硬护栏 / em 软叠加正交——后者影响「动作 / 展示分」，本模块只提供仓位与止损的量化参考。
 *
 * @module decision/riskProfile
 */

import type { KLineData } from "@/types";
import type { StockSdkIndicatorsResult } from "../stockSdkIndicators";

export type VolTier = "low" | "medium" | "high";

export interface RiskProfile {
  /** 年化波动率（%），基于日收益率样本标准差 × √252 */
  annualizedVol: number;
  /** 最大回撤（%），基于收盘价峰谷的最大跌幅，存为正向幅度（如 18.5 表示 -18.5%） */
  maxDrawdown: number;
  /** ATR 占末价百分比（%），无真实 OHLC 时为 0 */
  atrPct: number;
  /** 波动分档：low / medium / high */
  volTier: VolTier;
  /** 建议最大单标的仓位（%，组合权重上限参考） */
  suggestedMaxPosition: number;
  /** 止损参考（%，基于 2×ATR 或分档默认，clamp 到分档区间） */
  stopLossPct: number;
}

const TRADING_DAYS = 252;
const MIN_BARS = 20;

// 波动分档阈值（年化波动率 %）
const VOL_LOW_MAX = 25;
const VOL_HIGH_MIN = 40;

// 分档 → 建议最大仓位（%）
const TIER_POSITION: Record<VolTier, number> = { low: 70, medium: 50, high: 30 };
// 分档 → 止损参考区间 [floor, cap]（%）
const TIER_STOP: Record<VolTier, [number, number]> = {
  low: [5, 10],
  medium: [8, 15],
  high: [12, 20],
};

function stdSample(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function classifyTier(annualizedVol: number): VolTier {
  if (annualizedVol < VOL_LOW_MAX) return "low";
  if (annualizedVol < VOL_HIGH_MIN) return "medium";
  return "high";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * 计算波动 / 仓位风险画像。
 * 数据不足（有效收盘价 < 20 根）时返回 null，调用方不应挂载该字段。
 */
export function computeRiskProfile(
  klines: KLineData[],
  ind: StockSdkIndicatorsResult,
): RiskProfile | null {
  if (!klines || klines.length < MIN_BARS) return null;
  const closes = klines.map((k) => k.close).filter((c) => typeof c === "number" && c > 0);
  if (closes.length < MIN_BARS) return null;

  // 日收益率
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    rets.push((closes[i] - prev) / prev);
  }
  if (rets.length < 2) return null;

  // 年化波动率
  const dailyVol = stdSample(rets);
  const annualizedVol = dailyVol * Math.sqrt(TRADING_DAYS) * 100;

  // 最大回撤（峰谷）
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  const maxDrawdown = Math.abs(maxDd) * 100;

  // ATR%（无真实 OHLC 时 atr 缺失 → 0）
  const lastClose = closes[closes.length - 1];
  const atr = ind.latest.atr?.atr ?? null;
  const atrPct = atr != null && atr > 0 && lastClose > 0 ? (atr / lastClose) * 100 : 0;

  const volTier = classifyTier(annualizedVol);

  // 止损参考：优先 2×ATR，回退分档默认，最后 clamp 到分档区间
  const [stopFloor, stopCap] = TIER_STOP[volTier];
  let stopLossPct: number;
  if (atrPct > 0) {
    stopLossPct = clamp(atrPct * 2, stopFloor, stopCap);
  } else {
    stopLossPct = (stopFloor + stopCap) / 2;
  }

  return {
    annualizedVol: Number(annualizedVol.toFixed(1)),
    maxDrawdown: Number(maxDrawdown.toFixed(1)),
    atrPct: Number(atrPct.toFixed(2)),
    volTier,
    suggestedMaxPosition: TIER_POSITION[volTier],
    stopLossPct: Number(stopLossPct.toFixed(1)),
  };
}
