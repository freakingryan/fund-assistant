/**
 * 市场 regime 因子（剥离 beta 伪信号）
 *
 * 当前回测准确率里大量来自「大盘跌 → 卖出全对」。引入市场级状态
 * （沪深300ETF 510300 的动量 / MA 排列），把个基信号与大盘 beta 分离：
 * 空头市对多头信号打折，避免把「大盘跌所以卖出对」误记为个基 alpha。
 *
 * 取数走腾讯端点（已修复可用）；任何失败返回 neutral 兜底，不影响主流程。
 *
 * @module decision/regimeFactor
 */

import { dataSourceService } from "@/adapters/datasource/service";
import type { Direction } from "./types";

export interface MarketRegime {
  /** bull / bear / neutral */
  trend: Direction;
  /** 强度 0~1 */
  strength: number;
  /** 沪深300 近 60 日收益(%)，无数据为 null */
  momentum60: number | null;
  /** MA20 >= MA60 */
  maBull: boolean;
}

const FALLBACK: MarketRegime = { trend: "neutral", strength: 0, momentum60: null, maBull: false };

const REGIME_ETF = "510300";
const REGIME_PERIOD = "3m";
/** 判定市场状态所需最少收盘价样本（需覆盖 MA60 + 余量） */
const MIN_CLOSES = 21;
/** 动量回看窗口（日） */
const MOMENTUM_WINDOW = 60;
/** 短期 / 长期均线窗口 */
const MA_SHORT = 20;
const MA_LONG = 60;
/** 判定牛/熊的动量阈值(%)：|动量|超过此值且均线同向才给方向 */
const REGIME_MOMENTUM_THRESHOLD = 5;
/** 动量→强度(0~1)的缩放分母 */
const REGIME_STRENGTH_SCALE = 15;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ma(arr: number[], w: number): number {
  if (arr.length < w) return arr[arr.length - 1];
  return arr.slice(-w).reduce((a, b) => a + b, 0) / w;
}

/**
 * 取沪深300ETF(510300) K 线，算市场状态。
 * 取数失败 / 数据不足 → 返回 neutral 兜底（不抛、不影响评分）。
 */
export async function computeMarketRegime(): Promise<MarketRegime> {
  try {
    const kl = await dataSourceService.fetchEtfKLine(REGIME_ETF, REGIME_PERIOD);
    const closes = (kl ?? [])
      .map((k) => k.close)
      .filter((c): c is number => typeof c === "number" && c > 0);
    if (closes.length < MIN_CLOSES) return FALLBACK;

    const last = closes[closes.length - 1];
    const base =
      closes.length > MOMENTUM_WINDOW ? closes[closes.length - 1 - MOMENTUM_WINDOW] : closes[0];
    const momentum60 = ((last - base) / base) * 100;

    const maShort = ma(closes, MA_SHORT);
    const maLong = ma(closes, MA_LONG);
    const maBull = maShort >= maLong;

    let trend: Direction = "neutral";
    let strength = 0;
    if (momentum60 > REGIME_MOMENTUM_THRESHOLD && maBull) {
      trend = "bull";
      strength = clamp(momentum60 / REGIME_STRENGTH_SCALE, 0, 1);
    } else if (momentum60 < -REGIME_MOMENTUM_THRESHOLD && !maBull) {
      trend = "bear";
      strength = clamp(-momentum60 / REGIME_STRENGTH_SCALE, 0, 1);
    }
    return { trend, strength, momentum60: Number(momentum60.toFixed(2)), maBull };
  } catch {
    return FALLBACK;
  }
}
