/**
 * 回测 AI 辅助分析服务
 *
 * 复用既有 AI 基础设施（services/ai.ts 的 callAI / getDefaultAI），
 * 把回测统计 + 按日准确率序列 + 样本打包成结构化 Prompt，调用已配置的 LLM，
 * 解析出「算法薄弱环节 + 调参建议」，结果落库（aiAnalyses）可回看。
 *
 * 设计要点：
 * - 零新建 API 层，直接复用用户设置页已配置的 provider/apiKey（浏览器直连，需 CORS 友好端点）。
 * - AI 未配置时抛出明确错误（NoAIConfiguredError），UI 据此提示去设置页。
 * - 解析失败时退化为「保留 raw + 空结论」，不丢数据。
 *
 * @module backtest/aiAnalysis
 */

import { callAI, getDefaultAI } from '@/services/ai'
import { db } from '@/stores/db'
import type { BacktestStats, DailyAccuracyPoint } from './stats'
import { computeBacktestStats, computeDailyAccuracySeries } from './stats'
import type { AiBacktestAnalysis, ScoreSnapshot } from './types'

/** 送入 Prompt 的最近样本上限，避免超长上下文 */
const MAX_SNAPSHOTS_FOR_PROMPT = 200

/** 本地日历日 YYYY-MM-DD（与 decisionSnapshot.localDateKey 一致，避免循环依赖单独实现） */
function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 构造回测分析的 Prompt：把统计上下文（准确率/区间命中/按日序列/样本）结构化喂给 AI。
 */
export function buildBacktestAnalysisPrompt(
  stats: BacktestStats,
  daily: DailyAccuracyPoint[],
  snapshots: ScoreSnapshot[],
): string {
  const sample = snapshots
    .slice(-MAX_SNAPSHOTS_FOR_PROMPT)
    .map((s) => ({
      date: s.date,
      fund: s.fundName,
      score: s.score,
      rec: s.recommendation,
      nextPct: s.nextChangePct != null ? Number(s.nextChangePct.toFixed(2)) : null,
      outcome: s.outcome,
    }))

  const ctx = {
    total: stats.total,
    settled: stats.settled,
    directionalAccuracy: stats.directionalAccuracy != null ? Number((stats.directionalAccuracy * 100).toFixed(1)) : null,
    buyHitRate: stats.buyHitRate != null ? Number((stats.buyHitRate * 100).toFixed(1)) : null,
    sellHitRate: stats.sellHitRate != null ? Number((stats.sellHitRate * 100).toFixed(1)) : null,
    avgNextByRec: {
      buy: stats.avgNextByRec.buy != null ? Number(stats.avgNextByRec.buy.toFixed(2)) : null,
      hold: stats.avgNextByRec.hold != null ? Number(stats.avgNextByRec.hold.toFixed(2)) : null,
      sell: stats.avgNextByRec.sell != null ? Number(stats.avgNextByRec.sell.toFixed(2)) : null,
    },
    buckets: stats.buckets.map((b) => ({
      bucket: b.bucket,
      hitRate: b.hitRate != null ? Number((b.hitRate * 100).toFixed(1)) : null,
      count: b.count,
      avgNext: Number(b.avgNext.toFixed(2)),
    })),
    daily: daily.map((d) => ({
      date: d.date,
      accuracy: d.accuracy != null ? Number((d.accuracy * 100).toFixed(1)) : null,
      sampleCount: d.sampleCount,
      avgNextChange: d.avgNextChange != null ? Number(d.avgNextChange.toFixed(2)) : null,
    })),
  }

  return `你是一位专业的量化投资与基金决策算法诊断专家。下面是一个基金评分决策引擎的回测验证数据：每天收盘记录每只基金的"买/持/卖"建议与综合评分(0-100)，并在次日回填实际涨跌，用以验证建议的真实方向性准确率。

## 回测统计汇总
${JSON.stringify(ctx, null, 2)}

## 最近样本（最多 ${MAX_SNAPSHOTS_FOR_PROMPT} 条，取最新）
${JSON.stringify(sample, null, 2)}

## 你的任务
基于以上数据，诊断该决策算法的薄弱环节，并给出可落地的调参/策略改进建议。重点分析：
1. 方向性准确率整体是否可信？按日序列波动是否过大？有无连续多日失效？
2. 买入命中率 vs 卖出命中率是否失衡？哪一侧拖后腿？
3. 各评分区间命中率是否单调（高评分→高命中）？是否存在"高分反亏"的反常区间？
4. 按建议的次日平均涨跌分布，是否印证评分方向有效？
5. 资金面/板块赛道/同类排名等增强维度是否提升了区分度（看 buckets 与整体准确率）？

## 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块包裹，不要任何其他文字）：
{
  "weaknesses": ["算法薄弱环节1", "薄弱环节2"],
  "suggestions": ["调参/策略建议1", "建议2"],
  "summary": "总体结论与优先级建议（中文，≤120字）"
}
其中 weaknesses / suggestions 为中文短句，每条≤40字；若样本不足请如实说明并给出"先积累数据"的建议。`
}

/** AI 未配置时抛出，供 UI 引导去设置页 */
export class NoAIConfiguredError extends Error {
  constructor() {
    super('请先在设置页配置 AI API Key（默认 Provider）')
    this.name = 'NoAIConfiguredError'
  }
}

function parseAnalysisJson(text: string): { weaknesses: string[]; suggestions: string[]; summary: string } | null {
  const m = text.match(/\{[\s\S]*\}/)
  const raw = m ? m[0] : text
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj.weaknesses) && Array.isArray(obj.suggestions) && typeof obj.summary === 'string') {
      return {
        weaknesses: obj.weaknesses.map(String),
        suggestions: obj.suggestions.map(String),
        summary: String(obj.summary),
      }
    }
  } catch {
    // 解析失败：保留 raw，由调用方决定降级
  }
  return null
}

/**
 * 用已配置的 AI 分析回测数据，生成诊断并落库。
 * @param snapshots 全部快照（建议传 getAllSnapshots() 结果）
 * @returns 写入库的分析记录
 * @throws NoAIConfiguredError 未配置 AI；其他 Error 为调用/解析失败
 */
export async function analyzeBacktestWithAI(snapshots: ScoreSnapshot[]): Promise<AiBacktestAnalysis> {
  const ai = getDefaultAI()
  if (!ai || !ai.apiKey) throw new NoAIConfiguredError()

  const stats = computeBacktestStats(snapshots)
  const daily = computeDailyAccuracySeries(snapshots)
  const prompt = buildBacktestAnalysisPrompt(stats, daily, snapshots)

  let raw: string
  try {
    raw = await callAI(ai, [{ role: 'user', content: prompt }])
  } catch (e) {
    throw new Error(`AI 调用失败: ${e instanceof Error ? e.message : '未知错误'}`, { cause: e })
  }

  const parsed = parseAnalysisJson(raw)
  const analysis: AiBacktestAnalysis = {
    id: `ai-${Date.now()}`,
    date: localDateKey(),
    model: ai.model || ai.provider,
    provider: ai.provider,
    context: {
      total: stats.total,
      settled: stats.settled,
      directionalAccuracy: stats.directionalAccuracy,
      buyHitRate: stats.buyHitRate,
      sellHitRate: stats.sellHitRate,
      avgNextByRec: stats.avgNextByRec,
      buckets: stats.buckets,
      daily,
    },
    weaknesses: parsed?.weaknesses || [],
    suggestions: parsed?.suggestions || [],
    summary: parsed?.summary || 'AI 返回格式无法解析，请查看原始内容或重试。',
    raw,
    createdAt: Date.now(),
  }
  await db.aiAnalyses.put(analysis)
  return analysis
}

/** 读取全部 AI 分析记录（按生成时间倒序） */
export async function getAllAiAnalyses(): Promise<AiBacktestAnalysis[]> {
  return db.aiAnalyses.orderBy('createdAt').reverse().toArray()
}

/** 删除一条 AI 分析记录 */
export async function deleteAiAnalysis(id: string): Promise<void> {
  await db.aiAnalyses.delete(id)
}
