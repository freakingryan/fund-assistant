/**
 * NAV 原生因子（净值基金专属，纯本地、零网络）
 *
 * 净值基金收到的 klines 即 NAV 收盘价序列（仅有收盘价，无 OHLC）。
 * 原引擎只算 BIAS/ROC，浪费了「只用收盘价就能算」的动量/波动/回撤信号，
 * 再叠加 ×0.7 压缩 → 评分被压在 35-60、几乎给不出高分/买入。
 *
 * 本模块从 NAV 收盘价序列计算动量(20/60/120 日)、年化波动率、最大回撤、收益风险比，
 * 供决策引擎作为净值基金的「自有」方向性依据。窗口按可用长度自适应降级。
 *
 * @module decision/navFactors
 */

import type { KLineData } from "@/types";

export interface NavFactors {
  /** 是否具备足够样本计算因子 */
  available: boolean;
  /** 20 日 NAV 收益率(%)；样本不足为 null */
  momentum20: number | null;
  /** 60 日 NAV 收益率(%) */
  momentum60: number | null;
  /** 120 日 NAV 收益率(%)；历史不足为 null */
  momentum120: number | null;
  /** 年化波动率(%) */
  volatilityAnnual: number | null;
  /** 区间最大回撤(%)，负值表示回撤 */
  maxDrawdown: number | null;
  /** 收益风险比 = 日均收益 / 日收益标准差 */
  returnRisk: number | null;
}

/** 相对 back 根前的收益率(%)；不足样本返回 null */
function pctChange(series: number[], back: number): number | null {
  if (series.length <= back) return null;
  const past = series[series.length - 1 - back];
  if (!past) return null;
  return ((series[series.length - 1] - past) / past) * 100;
}

function stdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

/**
 * 从 NAV 收盘价序列计算动量/波动/回撤。
 * @param klines 净值 K 线（含 close）
 */
export function computeNavFactors(klines: KLineData[]): NavFactors {
  const closes = klines
    .map((k) => k.close)
    .filter((c): c is number => typeof c === "number" && c > 0);
  const n = closes.length;
  if (n < 5) {
    return {
      available: false,
      momentum20: null,
      momentum60: null,
      momentum120: null,
      volatilityAnnual: null,
      maxDrawdown: null,
      returnRisk: null,
    };
  }

  const momentum20 = pctChange(closes, 20);
  const momentum60 = pctChange(closes, 60);
  const momentum120 = pctChange(closes, 120);

  // 日收益率序列
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const volatilityAnnual = stdev(rets) * Math.sqrt(252) * 100;

  // 最大回撤
  let peak = closes[0];
  let mdd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  const maxDrawdown = mdd * 100;

  const meanRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = stdev(rets);
  const returnRisk = sd > 0 ? meanRet / sd : null;

  return {
    available: true,
    momentum20: momentum20 != null ? Number(momentum20.toFixed(2)) : null,
    momentum60: momentum60 != null ? Number(momentum60.toFixed(2)) : null,
    momentum120: momentum120 != null ? Number(momentum120.toFixed(2)) : null,
    volatilityAnnual: Number(volatilityAnnual.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    returnRisk: returnRisk != null ? Number(returnRisk.toFixed(3)) : null,
  };
}
