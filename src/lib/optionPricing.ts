/**
 * 期权定价核心（Black-Scholes 模型，纯前端零依赖）
 *
 * 提供：
 *  - bsPrice：理论价格
 *  - bsGreeks：五大希腊字母（delta / gamma / theta / vega / rho），均换算为交易者常用量级
 *  - impliedVol：由市场价反推隐含波动率（Newton 法，发散时回退二分法）
 *
 * 仅做数值计算，不触碰任何外部数据源 / 网络解析 —— 符合「不自写东财/腾讯解析」原则。
 * ETF 期权的 T 型报价来自新浪（src/services/etfOptions.ts），希腊字母与 IV 在此纯算。
 *
 * 约定：
 *  - 利率 r、波动率 sigma 均为「年化小数」（如 0.02 表示 2%）
 *  - 时间 T 为「年化年数」（如 30 个自然日 = 30/365）
 *  - theta 返回「每日」量级（年 theta / 365）
 *  - vega / rho 返回「每 1 个百分点」量级（原始值 / 100）
 *
 * @module optionPricing
 */

export type OptionType = "call" | "put";

export interface BsInput {
  type: OptionType;
  /** 标的现价 */
  S: number;
  /** 行权价 */
  K: number;
  /** 剩余时间（年化年数，如 daysLeft/365） */
  T: number;
  /** 无风险年化利率（小数） */
  r: number;
  /** 波动率（年化小数） */
  sigma: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  /** 每日 theta（价格/天） */
  theta: number;
  /** 每 1 个百分点波动率的 vega（价格/1%σ） */
  vega: number;
  /** 每 1 个百分点利率的 rho（价格/1%r） */
  rho: number;
}

/** 标准正态概率密度函数 */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** 标准正态累积分布函数（Abramowitz & Stegun 7.1.26 近似，误差 < 7.5e-8） */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes 理论价格。
 * 当 T<=0 或 sigma<=0 时退化为内在价值（T<=0）或无法定价（sigma<=0 返回 NaN）。
 */
export function bsPrice({ type, S, K, T, r, sigma }: BsInput): number {
  if (T <= 0) {
    // 已到期：价格 = 内在价值
    return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  if (sigma <= 0) return NaN;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === "call") {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Black-Scholes 五大希腊字母。
 * theta 已换算为「每日」量级；vega / rho 已换算为「每 1 个百分点」量级。
 */
export function bsGreeks({ type, S, K, T, r, sigma }: BsInput): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const gamma = pdf / (S * sigma * sqrtT);
  const vegaRaw = (S * pdf * sqrtT) / 100; // 每 1% σ
  const thetaCommon = -(S * pdf * sigma) / (2 * sqrtT) / 365; // 每日

  let delta: number;
  let rhoRaw: number;
  let thetaDrift: number;
  if (type === "call") {
    delta = normCdf(d1);
    rhoRaw = (K * T * Math.exp(-r * T) * normCdf(d2)) / 100; // 每 1% r
    thetaDrift = r * K * Math.exp(-r * T) * normCdf(d2);
  } else {
    delta = normCdf(d1) - 1;
    rhoRaw = (-K * T * Math.exp(-r * T) * normCdf(-d2)) / 100;
    thetaDrift = -r * K * Math.exp(-r * T) * normCdf(-d2);
  }
  const theta = thetaCommon - thetaDrift / 365;
  return { delta, gamma, theta, vega: vegaRaw, rho: rhoRaw };
}

/**
 * 由市场价反推隐含波动率（年化小数）。
 * 使用 Newton 法，当迭代发散（vega≈0 或越界）时回退二分法。
 * 失败返回 NaN。
 */
export function impliedVol(
  marketPrice: number,
  base: Omit<BsInput, "sigma">,
  tol = 1e-6,
  maxIter = 100,
): number {
  const price = marketPrice;
  if (!Number.isFinite(price) || price <= 0) return NaN;
  if (base.T <= 0) return NaN;

  // 内在价值下界：IV 至少应使理论价 >= 内在价值
  const intrinsic =
    base.type === "call" ? Math.max(base.S - base.K, 0) : Math.max(base.K - base.S, 0);
  if (price < intrinsic - 1e-9) return NaN;

  let sigma = 0.3; // 初始猜测 30%
  for (let i = 0; i < maxIter; i++) {
    const p = bsPrice({ ...base, sigma });
    const g = bsGreeks({ ...base, sigma });
    const diff = p - price;
    if (Math.abs(diff) < tol) return sigma;
    const vegaRaw = g.vega * 100; // 还原每单位 σ 的 vega
    if (!Number.isFinite(vegaRaw) || Math.abs(vegaRaw) < 1e-12) break;
    const next = sigma - diff / vegaRaw;
    if (next <= 0 || next > 5) break; // 超出合理区间，回退二分
    sigma = next;
  }

  // 二分法回退：在 [1e-4, 5] 区间收敛
  let lo = 1e-4;
  let hi = 5;
  let mid = sigma;
  for (let i = 0; i < 100; i++) {
    const p = bsPrice({ ...base, sigma: mid });
    if (Math.abs(p - price) < tol) return mid;
    if (p < price) lo = mid;
    else hi = mid;
    mid = (lo + hi) / 2;
    if (hi - lo < tol) break;
  }
  return mid;
}
