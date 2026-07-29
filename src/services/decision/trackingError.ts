/**
 * 联接基金跟踪误差（Tracking Error）折扣
 *
 * 联接基金（ETF 联接）的 klines 是底层 ETF 的真实 K 线（基准），
 * 但基金自身还有一份「联接基金 NAV」序列（与 ETF 不完全同步，存在申赎摩擦 / 现金拖累 / 跟踪偏离）。
 * 若 NAV 对 ETF 的日收益偏离过大（年化跟踪误差过高），说明该联接基金「名实不符」，
 * 直接用 ETF K 线给出的高分 / 买入信号置信度应打折——这就是 T3.2 的诚实化折扣。
 *
 * 计算：按日期对齐 基金NAV 与 ETF基准 的日收益率，求差序列，年化标准差即为跟踪误差(%)。
 *
 * @module decision/trackingError
 */

import type { KLineData } from "@/types";

/** 跟踪误差高阈值(%)：超过则对评分做温和折扣 */
export const TRACKING_ERROR_HIGH = 5;
/** 高跟踪误差时的评分折扣系数（×0.96 向 50 收敛，与低置信压缩同量级、正交） */
export const TRACKING_ERROR_DISCOUNT = 0.96;
/** 计算跟踪误差所需的最少对齐样本数（日收益差） */
export const TRACKING_ERROR_MIN_SAMPLES = 20;

function closeMap(klines: KLineData[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of klines) {
    if (typeof k.close === "number" && k.close > 0 && k.date) m.set(k.date, k.close);
  }
  return m;
}

function stdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

/**
 * 计算联接基金相对 ETF 基准的跟踪误差(%)。
 * @param navKlines 联接基金自身 NAV 序列（收盘价）
 * @param benchKlines 基准 ETF K 线序列（收盘价，即引擎传入的 klines）
 * @returns 年化跟踪误差(%)，样本不足返回 null
 */
export function computeTrackingError(
  navKlines: KLineData[],
  benchKlines: KLineData[],
): number | null {
  if (!navKlines?.length || !benchKlines?.length) return null;
  const benchMap = closeMap(benchKlines);
  const navMap = closeMap(navKlines);

  // 取交集日期，按日期升序
  const common = [...navMap.keys()].filter((d) => benchMap.has(d)).sort();
  if (common.length < TRACKING_ERROR_MIN_SAMPLES + 1) return null;

  const diffs: number[] = [];
  for (let i = 1; i < common.length; i++) {
    const d0 = common[i - 1];
    const d1 = common[i];
    const nav0 = navMap.get(d0)!;
    const nav1 = navMap.get(d1)!;
    const b0 = benchMap.get(d0)!;
    const b1 = benchMap.get(d1)!;
    if (nav0 <= 0 || nav1 <= 0 || b0 <= 0 || b1 <= 0) continue;
    const navRet = (nav1 - nav0) / nav0;
    const benchRet = (b1 - b0) / b0;
    diffs.push(navRet - benchRet);
  }
  if (diffs.length < TRACKING_ERROR_MIN_SAMPLES) return null;

  const te = stdev(diffs) * Math.sqrt(252) * 100;
  return Number(te.toFixed(2));
}
