/**
 * AI 调参提案服务（T5.2 — AI 调参反馈环的核心闭环）
 *
 * 流程：回测统计 → LLM 结构化提案（paramDiff）→ 白名单校验 → 落库待审
 *      → 用户人审「采纳」→ 写入 settings.decisionParams（引擎即时生效）
 *      → 可随时「回滚」到采纳前快照 / 「恢复默认」。
 *
 * 安全边界（反幻觉硬约束）：
 * - AI 只能输出 PARAM_SCHEMA 白名单内的数值叶子 diff；路径非法 / 数值非法的项直接丢弃（droppedCount 透明记录）。
 * - 采纳时数值二次 clamp 到 schema min/max；AI 永远不改算法结构。
 * - 采纳前自动快照旧 override（prevOverride），支持一键回滚。
 *
 * @module backtest/tuningProposal
 */

import { callAI, getDefaultAI } from "@/services/ai";
import { db } from "@/stores/db";
import { extractJsonFromLLM } from "@/lib/json";
import { useSettingsStore } from "@/stores/settings";
import {
  DEFAULT_PARAMS,
  PARAM_SCHEMA,
  getDecisionParams,
  getParamByPath,
  type DecisionParams,
  type DeepPartial,
} from "@/services/decision/decisionParams";
import { computeBacktestStats, computeDailyAccuracySeries } from "./stats";
import { NoAIConfiguredError } from "./aiAnalysis";
import type { ParamDiffItem, ScoreSnapshot, TuningProposal } from "./types";

/** 送入 Prompt 的最近样本上限 */
const MAX_SNAPSHOTS_FOR_PROMPT = 150;

function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 按点路径在嵌套对象上写值（构造 override 用） */
function setByPath(obj: Record<string, unknown>, path: string, value: number): void {
  const segs = path.split(".");
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

/**
 * 构造调参提案 Prompt：当前生效参数 + 白名单 schema + 回测统计 → 要求输出结构化 paramDiff。
 */
export function buildTuningProposalPrompt(snapshots: ScoreSnapshot[]): string {
  const stats = computeBacktestStats(snapshots);
  const daily = computeDailyAccuracySeries(snapshots);
  const params = getDecisionParams();

  const sample = snapshots.slice(-MAX_SNAPSHOTS_FOR_PROMPT).map((s) => ({
    date: s.date,
    fund: s.fundName,
    score: s.score,
    rec: s.recommendation,
    nextPct: s.nextChangePct != null ? Number(s.nextChangePct.toFixed(2)) : null,
    outcome: s.outcome,
  }));

  const statsCtx = {
    total: stats.total,
    settled: stats.settled,
    directionalAccuracy:
      stats.directionalAccuracy != null
        ? Number((stats.directionalAccuracy * 100).toFixed(1))
        : null,
    directionalCoverage:
      stats.directionalCoverage != null
        ? Number((stats.directionalCoverage * 100).toFixed(1))
        : null,
    buyHitRate: stats.buyHitRate != null ? Number((stats.buyHitRate * 100).toFixed(1)) : null,
    sellHitRate: stats.sellHitRate != null ? Number((stats.sellHitRate * 100).toFixed(1)) : null,
    avgNextByRec: stats.avgNextByRec,
    buckets: stats.buckets.map((b) => ({
      bucket: b.bucket,
      hitRate: b.hitRate != null ? Number((b.hitRate * 100).toFixed(1)) : null,
      count: b.count,
      avgNext: Number(b.avgNext.toFixed(2)),
    })),
    daily: daily.slice(-30),
  };

  const schemaCtx = PARAM_SCHEMA.map((m) => ({
    path: m.path,
    label: m.label,
    min: m.min,
    max: m.max,
    current: getParamByPath(params, m.path),
    default: getParamByPath(DEFAULT_PARAMS, m.path),
  }));

  return `你是一位专业的量化决策算法调参专家。下面是一个基金评分决策引擎的「当前可调参数表」与「回测验证统计」。你的任务是：基于回测证据，提出**最多 5 条**最有把握的参数调整建议（结构化 diff），供人工审核后采纳。

## 可调参数白名单（只能修改这里列出的 path，超出范围会被丢弃）
${JSON.stringify(schemaCtx, null, 2)}

## 回测统计（每日收盘记录建议，次日回填实际涨跌验证）
${JSON.stringify(statsCtx, null, 2)}

## 最近样本（最多 ${MAX_SNAPSHOTS_FOR_PROMPT} 条）
${JSON.stringify(sample, null, 2)}

## 调参原则（必须遵守）
1. **证据优先**：每条建议必须援引统计中的具体证据（如"60-70 区间命中率仅 40%"），禁止无证据的凭感觉调整。
2. **保守微调**：单参数调整幅度不超过其当前值的 ±30%（权重类）或白名单区间的 ±20%（阈值类）；样本 settled < 30 时最多提 2 条且注明"样本不足，建议观察"。
3. **只调白名单**：path 必须完全匹配白名单；proposed 必须落在 [min, max] 内。
4. **不改算法**：你只能提数值调整，不能建议增删规则/改变结构。
5. 若统计证据不足以支撑任何调整，diffs 返回空数组并在 expectedImpact 中说明。

## 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块，不要其他文字）：
{
  "diffs": [
    { "path": "weights.trend", "current": 30, "proposed": 27, "reason": "证据+理由（中文，≤50字）" }
  ],
  "expectedImpact": "总体预期影响与风险提示（中文，≤120字）"
}`;
}

interface ParsedProposal {
  diffs: ParamDiffItem[];
  droppedCount: number;
  expectedImpact: string;
}

/** 解析并校验 AI 输出：路径白名单 + 数值合法性 + clamp；非法项丢弃并计数 */
export function parseAndValidateProposal(raw: string): ParsedProposal | null {
  const obj = extractJsonFromLLM(raw);
  if (!obj || !Array.isArray(obj.diffs)) return null;
  const schemaByPath = new Map(PARAM_SCHEMA.map((m) => [m.path, m]));
  const params = getDecisionParams();
  const diffs: ParamDiffItem[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const item of obj.diffs as unknown[]) {
    if (typeof item !== "object" || item === null) {
      dropped++;
      continue;
    }
    const rec = item as Record<string, unknown>;
    const path = typeof rec.path === "string" ? rec.path : null;
    const proposed = typeof rec.proposed === "number" ? rec.proposed : Number(rec.proposed);
    const meta = path ? schemaByPath.get(path) : undefined;
    if (!path || !meta || !Number.isFinite(proposed) || seen.has(path)) {
      dropped++;
      continue;
    }
    const current = getParamByPath(params, path);
    if (current == null) {
      dropped++;
      continue;
    }
    const clamped = clamp(proposed, meta.min, meta.max);
    // 与当前值相同的"调整"无意义，丢弃
    if (clamped === current) {
      dropped++;
      continue;
    }
    seen.add(path);
    diffs.push({
      path,
      current,
      proposed: clamped,
      reason: typeof rec.reason === "string" ? rec.reason : "",
    });
  }
  return {
    diffs: diffs.slice(0, 5),
    droppedCount: dropped + Math.max(0, diffs.length - 5),
    expectedImpact: typeof obj.expectedImpact === "string" ? obj.expectedImpact : "",
  };
}

/**
 * 生成 AI 调参提案（落库 pending，不改任何参数）。
 * @throws NoAIConfiguredError 未配置 AI
 */
export async function generateTuningProposal(
  snapshots: ScoreSnapshot[],
  trigger: "manual" | "auto",
): Promise<TuningProposal> {
  const ai = getDefaultAI();
  if (!ai || !ai.apiKey) throw new NoAIConfiguredError();

  const stats = computeBacktestStats(snapshots);
  const prompt = buildTuningProposalPrompt(snapshots);

  let raw: string;
  try {
    raw = await callAI(ai, [{ role: "user", content: prompt }]);
  } catch (e) {
    throw new Error(`AI 调用失败: ${e instanceof Error ? e.message : "未知错误"}`, { cause: e });
  }

  const parsed = parseAndValidateProposal(raw);
  const proposal: TuningProposal = {
    id: `tune-${Date.now()}`,
    date: localDateKey(),
    model: ai.model || ai.provider,
    provider: ai.provider,
    trigger,
    statsSummary: {
      settled: stats.settled,
      directionalAccuracy: stats.directionalAccuracy,
      buyHitRate: stats.buyHitRate,
      sellHitRate: stats.sellHitRate,
    },
    diffs: parsed?.diffs ?? [],
    droppedCount: parsed?.droppedCount ?? 0,
    expectedImpact: parsed?.expectedImpact || (parsed ? "" : "AI 返回格式无法解析，请重试。"),
    status: "pending",
    decidedAt: null,
    prevOverride: null,
    raw,
    createdAt: Date.now(),
  };
  // 同一时间只保留一份 pending：新提案生成时自动作废旧 pending
  const olds = await db.tuningProposals.where("status").equals("pending").toArray();
  for (const o of olds) {
    await db.tuningProposals.update(o.id, { status: "rejected", decidedAt: Date.now() });
  }
  await db.tuningProposals.put(proposal);
  return proposal;
}

/**
 * 人审采纳提案：把 diffs 合入 settings.decisionParams（引擎即时生效）。
 * 采纳前快照旧 override 供回滚。
 */
export async function adoptTuningProposal(id: string): Promise<void> {
  const proposal = await db.tuningProposals.get(id);
  if (!proposal || proposal.status !== "pending") throw new Error("提案不存在或已处理");
  if (proposal.diffs.length === 0) throw new Error("提案不含任何有效参数调整");

  const store = useSettingsStore.getState();
  const prevOverride = (store.settings.decisionParams ?? null) as Record<string, unknown> | null;

  // 基于旧 override 增量合并本次 diffs（clamp 二次兜底）
  const schemaByPath = new Map(PARAM_SCHEMA.map((m) => [m.path, m]));
  const next: Record<string, unknown> = structuredClone(prevOverride ?? {});
  for (const d of proposal.diffs) {
    const meta = schemaByPath.get(d.path);
    if (!meta) continue;
    setByPath(next, d.path, clamp(d.proposed, meta.min, meta.max));
  }

  await store.updateSettings({ decisionParams: next as DeepPartial<DecisionParams> });
  await db.tuningProposals.update(id, {
    status: "adopted",
    decidedAt: Date.now(),
    prevOverride,
  });
}

/** 人审拒绝提案 */
export async function rejectTuningProposal(id: string): Promise<void> {
  await db.tuningProposals.update(id, { status: "rejected", decidedAt: Date.now() });
}

/** 回滚一条已采纳提案：恢复采纳前的 override 快照 */
export async function rollbackTuningProposal(id: string): Promise<void> {
  const proposal = await db.tuningProposals.get(id);
  if (!proposal || proposal.status !== "adopted") throw new Error("提案不存在或不可回滚");
  const store = useSettingsStore.getState();
  await store.updateSettings({
    decisionParams: (proposal.prevOverride ?? undefined) as DeepPartial<DecisionParams> | undefined,
  });
  await db.tuningProposals.update(id, { status: "rolledBack", decidedAt: Date.now() });
}

/** 恢复全部默认参数（清空 override；不改动提案历史） */
export async function resetDecisionParamsToDefault(): Promise<void> {
  await useSettingsStore.getState().updateSettings({ decisionParams: undefined });
}

/** 当前待审提案（最多一份） */
export async function getPendingProposal(): Promise<TuningProposal | null> {
  const list = await db.tuningProposals.where("status").equals("pending").toArray();
  if (list.length === 0) return null;
  return list.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** 全部提案历史（倒序） */
export async function getAllTuningProposals(): Promise<TuningProposal[]> {
  return db.tuningProposals.orderBy("createdAt").reverse().toArray();
}
