/**
 * Analysis Context Pack — 把喂给 LLM 的上下文拆成带状态的块（移植自 DSA `analysis_context_pack_prompt.py`）
 *
 * 每块标注 `available / missing / fallback / stale / estimated / partial / fetch_failed`，
 * 整体区分质量级 `good / usable / limited / poor`。
 *
 * 这是对 §3.2「静默空值防护」的上游补强：在组装 AI 上下文时**显式告诉模型哪些数据缺失/降级**，
 * 而不是静默留白让模型幻觉（见 `contextPackToPromptSection`）。
 *
 * 纯函数、零依赖、零接口。
 *
 * @module decision/contextPack
 */

import type { KLineData } from "@/types";

/** 单块数据状态（DSA 7 态） */
export type ContextBlockStatus =
  "available" | "missing" | "fallback" | "stale" | "estimated" | "partial" | "fetch_failed";

/** 整体上下文质量级 */
export type ContextQuality = "good" | "usable" | "limited" | "poor";

export interface ContextPackBlock {
  /** 块标识 */
  key: string;
  /** 中文标签 */
  label: string;
  status: ContextBlockStatus;
  quality: ContextQuality;
  /** 人类可读说明（降级原因 / 数据来源等） */
  detail?: string;
  /** 数据时点（如行情/基本面获取日期） */
  asOf?: number | null;
}

export interface AnalysisContextPack {
  blocks: ContextPackBlock[];
  quality: ContextQuality;
  /** 一句话总结（给模型 / UI） */
  summary: string;
}

/** 构建输入：由控制器从既有状态裁剪出的布尔 / 轻量字段（保持本模块与上游解耦） */
export interface BuildContextPackInput {
  hasQuote: boolean;
  quoteAsOf?: number | null;
  klineData: KLineData[];
  /** 场内 ETF 真实 K 线（false = 净值走势，无盘中区间） */
  isRealKline: boolean;
  /** 技术指标 / 形态 / 综合评分已计算 */
  hasTechnical: boolean;
  /** 重仓股穿透或 NAV 因子可用 */
  hasFundamental: boolean;
  fundamentalAsOf?: number | null;
  /** 任意东财交叉截面因子可用 */
  emAvailable: boolean;
  /** 市场 regime 已计算 */
  regimeAvailable: boolean;
  /** 新闻/舆情源（fund-assistant 当前无，恒为 false） */
  hasNews?: boolean;
}

const STATUS_LABEL: Record<ContextBlockStatus, string> = {
  available: "可用",
  missing: "缺失",
  fallback: "降级(回退)",
  stale: "过期",
  estimated: "估算",
  partial: "部分",
  fetch_failed: "获取失败",
};

const QUALITY_LABEL: Record<ContextQuality, string> = {
  good: "充足",
  usable: "可用",
  limited: "有限",
  poor: "不足",
};

const DEGRADED: ContextBlockStatus[] = ["fallback", "stale", "estimated", "partial"];
const FAILED: ContextBlockStatus[] = ["missing", "fetch_failed"];
/** 核心块：决定整体质量；增强块（em/regime/news）缺失不拉低核心结论 */
const CORE_KEYS = ["quote", "kline", "technical", "fundamental"];

/**
 * 由上游数据状态构建分析上下文包。
 */
export function buildContextPack(input: BuildContextPackInput): AnalysisContextPack {
  const blocks: ContextPackBlock[] = [];

  // 行情
  blocks.push({
    key: "quote",
    label: "实时行情",
    status: input.hasQuote ? "available" : "missing",
    quality: input.hasQuote ? "good" : "poor",
    detail: input.hasQuote ? "基金最新净值/估值已获取" : "未获取到实时行情",
    asOf: input.quoteAsOf,
  });

  // 日线（真实 K 线 / 净值回退 / 缺失）
  let klineStatus: ContextBlockStatus;
  let klineQuality: ContextQuality;
  let klineDetail: string;
  if (input.klineData.length === 0) {
    klineStatus = "missing";
    klineQuality = "poor";
    klineDetail = "无 K 线数据";
  } else if (input.isRealKline) {
    klineStatus = "available";
    klineQuality = "good";
    klineDetail = `场内 ETF 真实 K 线（${input.klineData.length} 根）`;
  } else {
    klineStatus = "fallback";
    klineQuality = "limited";
    klineDetail = "净值走势（无盘中区间，指标置信度较低）";
  }
  blocks.push({
    key: "kline",
    label: "K 线/日线",
    status: klineStatus,
    quality: klineQuality,
    detail: klineDetail,
  });

  // 技术面
  blocks.push({
    key: "technical",
    label: "技术指标/形态",
    status: input.hasTechnical ? "available" : "missing",
    quality: input.hasTechnical ? "good" : "poor",
    detail: input.hasTechnical ? "指标/形态/综合评分已计算" : "未计算技术信号",
  });

  // 基本面 / 持仓穿透
  blocks.push({
    key: "fundamental",
    label: "基本面/持仓穿透",
    status: input.hasFundamental ? "available" : "missing",
    quality: input.hasFundamental ? "good" : "limited",
    detail: input.hasFundamental ? "重仓股穿透或净值因子可用" : "无持仓穿透数据",
    asOf: input.fundamentalAsOf,
  });

  // 东财增强因子（overlay；不可用 → 不影响评分，但透明标注）
  blocks.push({
    key: "em",
    label: "东财增强因子",
    status: input.emAvailable ? "available" : "missing",
    quality: input.emAvailable ? "usable" : "limited",
    detail: input.emAvailable ? "资金面/板块/同类排名可用" : "东财未接入（叠加层增量恒为 0）",
  });

  // 市场状态（regime）
  blocks.push({
    key: "regime",
    label: "市场状态(regime)",
    status: input.regimeAvailable ? "available" : "missing",
    quality: input.regimeAvailable ? "usable" : "limited",
    detail: input.regimeAvailable ? "沪深300 regime 已计算" : "未计算市场 regime",
  });

  // 新闻 / 舆情（fund-assistant 无此源，明确标注避免幻觉）
  blocks.push({
    key: "news",
    label: "新闻/舆情",
    status: input.hasNews ? "available" : "missing",
    quality: input.hasNews ? "good" : "limited",
    detail: "本工具不提供新闻源",
  });

  const quality = deriveQuality(blocks);
  return { blocks, quality, summary: buildPackSummary(quality, blocks) };
}

/** 整体质量：核心块（行情/日线/技术/基本面）决定；增强块缺失不拉低核心结论 */
function deriveQuality(blocks: ContextPackBlock[]): ContextQuality {
  const core = blocks.filter((b) => CORE_KEYS.includes(b.key));
  const failing = core.filter((b) => FAILED.includes(b.status)).length;
  const degraded = core.filter((b) => DEGRADED.includes(b.status)).length;
  if (failing === 0 && degraded === 0) return "good";
  if (failing === 0) return "usable";
  if (failing === 1) return "limited";
  return "poor";
}

function buildPackSummary(quality: ContextQuality, blocks: ContextPackBlock[]): string {
  const degraded = blocks.filter((b) => DEGRADED.includes(b.status)).map((b) => b.label);
  const missing = blocks.filter((b) => FAILED.includes(b.status)).map((b) => b.label);
  let s = `上下文数据质量：${QUALITY_LABEL[quality]}`;
  if (degraded.length) s += `；降级块：${degraded.join("、")}`;
  if (missing.length) s += `；缺失块：${missing.join("、")}`;
  return s;
}

/**
 * 把上下文包序列化为给 LLM 的「数据齐备度」章节。
 * 空 / undefined → 返回空串（加性扩展，未提供时 prompt 输出与现在逐字节一致，回归安全）。
 */
export function contextPackToPromptSection(pack?: AnalysisContextPack): string {
  if (!pack || pack.blocks.length === 0) return "";
  const lines = pack.blocks.map((b) => {
    const st = STATUS_LABEL[b.status];
    return `- **${b.label}**：${st}${b.detail ? `（${b.detail}）` : ""}`;
  });
  return [
    "### 数据齐备度（上下文质量）",
    `整体质量：${QUALITY_LABEL[pack.quality]}`,
    "",
    ...lines,
    "",
    "> 分析要求：标注「缺失 / 降级 / 失败」的数据块，请在结论中明确说明其局限性，不要基于缺失数据下确定结论。",
  ].join("\n");
}
