/**
 * 决策引擎可调参数（T5.1 参数外置）
 *
 * 设计原则：
 *  1. **纯模块**：零依赖（不 import zustand / dexie / @/types），Node 端脚本
 *     （verify-decision.mts）可直接运行——无 override 时行为与硬编码时代逐字节一致。
 *  2. **注入式覆盖**：浏览器侧由 settings store 在 load/update 时调用
 *     `setDecisionParamsOverride(settings.decisionParams)` 推入用户覆盖；
 *     引擎通过 `getDecisionParams()` 读取合并后的生效参数。
 *  3. **Schema 白名单**：`PARAM_SCHEMA` 列出全部可调数值叶子（路径/标签/范围/分组），
 *     是 T5.2 `applyTuningProposal` 的唯一合法修改面——AI 只能在白名单内提数值 diff，
 *     永远不能改算法结构。
 *
 * @module decision/decisionParams
 */

/** 决策引擎全部可调参数（默认值 = T4 及以前的硬编码常量，逐字节一致） */
export interface DecisionParams {
  /** 类别基础权重（navmom 仅净值模式动态加入；overlay 类不计入） */
  weights: {
    trend: number;
    macd: number;
    momentum: number;
    bias: number;
    volume: number;
    pattern: number;
    navmom: number;
  };
  /** 东财因子软叠加层 */
  emOverlay: {
    /** 评分中性基准（0~100 中的 50） */
    neutral: number;
    /** 资金面/板块 评分偏离中性 → 增量 的缩放系数 */
    factorScale: number;
    /** 单个东财因子对综合评分的最大增量(±) */
    factorCap: number;
    /** 全部东财因子叠加后的总增量上限(±) */
    totalCap: number;
    /** 同类排名百分位 → 增量 的缩放分母 */
    peerScale: number;
  };
  /** 市场 regime 折扣 */
  regime: {
    /** 强度 → 折扣比例 的缩放系数 */
    discScale: number;
    /** 折扣比例上限 */
    discMax: number;
  };
  /** 多空冲突判定：弱势方 ≥ 强势方的此比例即视为分歧较大 */
  conflict: {
    minorityRatio: number;
  };
  /** 评分 → 八态原始动作 阈值（≥buy → buy；≥add → add；…；否则 sell） */
  action: {
    buy: number;
    add: number;
    hold: number;
    reduce: number;
  };
  /** 评级阈值（risk = 空头/冲突上下文；normal = 正常上下文） */
  rating: {
    /** 趋势买入共振门槛：score ≥ buyScore 且 bullRatio ≥ buyBullRatio */
    buyScore: number;
    buyBullRatio: number;
    /** strong_buy 更高共振门槛（仅正常上下文） */
    strongBuyScore: number;
    /** 风险上下文分档 */
    riskHold: number;
    riskReduce: number;
    riskSell: number;
    /** 正常上下文分档 */
    normalHold: number;
    normalReduce: number;
  };
  /** 净值模式低置信压缩（评分向 50 收敛系数） */
  lowConfidence: {
    /** 有 NAV 因子依据时的软化压缩 */
    compressWithNav: number;
    /** 无 NAV 因子时的强压缩 */
    compressWithoutNav: number;
  };
  /** T1 上下文护栏阈值 */
  guardrail: {
    /** 技术偏多但资金面分低于此值 → 资金背离降级 */
    capitalDivergenceBelow: number;
    /** 技术偏多但板块强度分低于此值 → 板块逆风降级 */
    sectorHeadwindBelow: number;
  };
}

/** 默认参数 — 与 T4 及以前 decisionEngine.ts 内联常量逐字节一致，勿随意改动 */
export const DEFAULT_PARAMS: DecisionParams = {
  weights: { trend: 30, macd: 10, momentum: 15, bias: 20, volume: 15, pattern: 10, navmom: 12 },
  emOverlay: { neutral: 50, factorScale: 0.1, factorCap: 5, totalCap: 12, peerScale: 10 },
  regime: { discScale: 0.5, discMax: 0.5 },
  conflict: { minorityRatio: 0.4 },
  action: { buy: 80, add: 60, hold: 45, reduce: 30 },
  rating: {
    buyScore: 70,
    buyBullRatio: 0.6,
    strongBuyScore: 75,
    riskHold: 60,
    riskReduce: 45,
    riskSell: 30,
    normalHold: 45,
    normalReduce: 30,
  },
  lowConfidence: { compressWithNav: 0.9, compressWithoutNav: 0.7 },
  guardrail: { capitalDivergenceBelow: 50, sectorHeadwindBelow: 40 },
};

/** 单个可调参数叶子的元信息（T5.2 白名单 + T5.4 UI 渲染） */
export interface ParamLeafMeta {
  /** 点路径，如 "weights.trend" */
  path: string;
  /** 中文标签 */
  label: string;
  /** 合法区间（applyTuningProposal 会 clamp） */
  min: number;
  max: number;
  /** 建议步长（UI 用） */
  step: number;
  /** 分组（UI 用） */
  group: string;
}

/** 可调参数白名单 Schema：AI 调参只允许修改这里列出的数值叶子 */
export const PARAM_SCHEMA: ParamLeafMeta[] = [
  { path: "weights.trend", label: "趋势权重", min: 5, max: 50, step: 1, group: "类别权重" },
  { path: "weights.macd", label: "MACD权重", min: 0, max: 30, step: 1, group: "类别权重" },
  { path: "weights.momentum", label: "动量权重", min: 0, max: 30, step: 1, group: "类别权重" },
  { path: "weights.bias", label: "乖离权重", min: 0, max: 40, step: 1, group: "类别权重" },
  { path: "weights.volume", label: "量能权重", min: 0, max: 30, step: 1, group: "类别权重" },
  { path: "weights.pattern", label: "形态权重", min: 0, max: 30, step: 1, group: "类别权重" },
  { path: "weights.navmom", label: "净值动量权重", min: 0, max: 30, step: 1, group: "类别权重" },
  {
    path: "emOverlay.factorScale",
    label: "东财因子缩放",
    min: 0,
    max: 0.5,
    step: 0.01,
    group: "东财叠加",
  },
  {
    path: "emOverlay.factorCap",
    label: "单因子增量上限",
    min: 0,
    max: 15,
    step: 1,
    group: "东财叠加",
  },
  {
    path: "emOverlay.totalCap",
    label: "叠加总增量上限",
    min: 0,
    max: 25,
    step: 1,
    group: "东财叠加",
  },
  {
    path: "emOverlay.peerScale",
    label: "同类排名缩放分母",
    min: 2,
    max: 50,
    step: 1,
    group: "东财叠加",
  },
  {
    path: "regime.discScale",
    label: "Regime折扣缩放",
    min: 0,
    max: 1,
    step: 0.05,
    group: "市场环境",
  },
  {
    path: "regime.discMax",
    label: "Regime折扣上限",
    min: 0,
    max: 1,
    step: 0.05,
    group: "市场环境",
  },
  {
    path: "conflict.minorityRatio",
    label: "多空冲突判定比例",
    min: 0.1,
    max: 0.9,
    step: 0.05,
    group: "冲突判定",
  },
  { path: "action.buy", label: "买入动作阈值", min: 60, max: 95, step: 1, group: "动作阈值" },
  { path: "action.add", label: "加仓动作阈值", min: 45, max: 80, step: 1, group: "动作阈值" },
  { path: "action.hold", label: "持有动作阈值", min: 30, max: 60, step: 1, group: "动作阈值" },
  { path: "action.reduce", label: "减仓动作阈值", min: 10, max: 45, step: 1, group: "动作阈值" },
  {
    path: "rating.buyScore",
    label: "买入评级分数门槛",
    min: 55,
    max: 90,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.buyBullRatio",
    label: "买入评级多头占比门槛",
    min: 0.5,
    max: 0.9,
    step: 0.05,
    group: "评级阈值",
  },
  {
    path: "rating.strongBuyScore",
    label: "强烈买入分数门槛",
    min: 65,
    max: 95,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.riskHold",
    label: "风险上下文持有线",
    min: 45,
    max: 75,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.riskReduce",
    label: "风险上下文减仓线",
    min: 30,
    max: 60,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.riskSell",
    label: "风险上下文卖出线",
    min: 10,
    max: 45,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.normalHold",
    label: "正常上下文持有线",
    min: 30,
    max: 60,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "rating.normalReduce",
    label: "正常上下文减仓线",
    min: 10,
    max: 45,
    step: 1,
    group: "评级阈值",
  },
  {
    path: "lowConfidence.compressWithNav",
    label: "低置信压缩(有NAV)",
    min: 0.5,
    max: 1,
    step: 0.05,
    group: "低置信压缩",
  },
  {
    path: "lowConfidence.compressWithoutNav",
    label: "低置信压缩(无NAV)",
    min: 0.3,
    max: 1,
    step: 0.05,
    group: "低置信压缩",
  },
  {
    path: "guardrail.capitalDivergenceBelow",
    label: "资金背离护栏阈值",
    min: 30,
    max: 60,
    step: 1,
    group: "护栏阈值",
  },
  {
    path: "guardrail.sectorHeadwindBelow",
    label: "板块逆风护栏阈值",
    min: 20,
    max: 55,
    step: 1,
    group: "护栏阈值",
  },
];

/** 深层部分覆盖类型（嵌套对象逐层可选） */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(override)) {
    const ov = (override as Record<string, unknown>)[k];
    const bv = (base as Record<string, unknown>)[k];
    if (ov === undefined) continue;
    out[k] =
      isPlainObject(ov) && isPlainObject(bv) ? deepMerge(bv, ov as DeepPartial<typeof bv>) : ov;
  }
  return out as T;
}

// ─── 覆盖注入（浏览器侧 settings store 推入；Node 端脚本不推 → 恒为默认值） ───
let currentOverride: DeepPartial<DecisionParams> | undefined;
let cached: DecisionParams = DEFAULT_PARAMS;

/**
 * 注入用户覆盖（settings.decisionParams）。传 undefined / 空对象 = 恢复默认。
 * 由 settings store 在 loadSettings / updateSettings 时调用。
 */
export function setDecisionParamsOverride(override: DeepPartial<DecisionParams> | undefined): void {
  currentOverride = override;
  cached =
    override && Object.keys(override).length > 0
      ? deepMerge(DEFAULT_PARAMS, override)
      : DEFAULT_PARAMS;
}

/** 读取当前生效参数（默认值 ⊕ 用户覆盖）。引擎每次 buildDecision 调用时读取。 */
export function getDecisionParams(): DecisionParams {
  return cached;
}

/** 当前是否存在用户覆盖（UI 标注「已自定义」用） */
export function hasDecisionParamsOverride(): boolean {
  return currentOverride != null && Object.keys(currentOverride).length > 0;
}

/** 按点路径读取参数叶子值（T5.2/T5.4 用） */
export function getParamByPath(params: DecisionParams, path: string): number | undefined {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return typeof cur === "number" ? cur : undefined;
}
