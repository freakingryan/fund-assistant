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

import { callAI, getDefaultAI } from "@/services/ai";
import { db } from "@/stores/db";
import type { BacktestStats, SourceAccuracy } from "./stats";
import { computeBacktestStats, computeDailyAccuracySeries } from "./stats";
import type { AiBacktestAnalysis, DailyAccuracyPoint, ScoreSnapshot } from "./types";

/** 送入 Prompt 的最近样本上限，避免超长上下文 */
const MAX_SNAPSHOTS_FOR_PROMPT = 200;

/** 本地日历日 YYYY-MM-DD（与 decisionSnapshot.localDateKey 一致，避免循环依赖单独实现） */
function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 把单数据源准确率压缩为 Prompt 友好的数值对象 */
function sourceAccuracyToCtx(s: SourceAccuracy): {
  settled: number;
  directionalTotal: number;
  directionalAccuracy: number | null;
  avgNext: number | null;
} {
  return {
    settled: s.settled,
    directionalTotal: s.directionalTotal,
    directionalAccuracy:
      s.directionalAccuracy != null ? Number((s.directionalAccuracy * 100).toFixed(1)) : null,
    avgNext: s.avgNext != null ? Number(s.avgNext.toFixed(2)) : null,
  };
}

/**
 * 构造回测分析的 Prompt：把统计上下文（准确率/区间命中/按日序列/样本）结构化喂给 AI。
 */
export function buildBacktestAnalysisPrompt(
  stats: BacktestStats,
  daily: DailyAccuracyPoint[],
  snapshots: ScoreSnapshot[],
): string {
  const sample = snapshots.slice(-MAX_SNAPSHOTS_FOR_PROMPT).map((s) => ({
    date: s.date,
    fund: s.fundName,
    score: s.score,
    rec: s.recommendation,
    nextPct: s.nextChangePct != null ? Number(s.nextChangePct.toFixed(2)) : null,
    outcome: s.outcome,
  }));

  const ctx = {
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
    avgNextByRec: {
      buy: stats.avgNextByRec.buy != null ? Number(stats.avgNextByRec.buy.toFixed(2)) : null,
      hold: stats.avgNextByRec.hold != null ? Number(stats.avgNextByRec.hold.toFixed(2)) : null,
      sell: stats.avgNextByRec.sell != null ? Number(stats.avgNextByRec.sell.toFixed(2)) : null,
    },
    buckets: stats.buckets.map((b) => ({
      bucket: b.bucket,
      // count=方向性样本数(correct+wrong)；settledCount=该区间全部已结算(含持有)
      hitRate: b.hitRate != null ? Number((b.hitRate * 100).toFixed(1)) : null,
      count: b.count,
      settledCount: b.settledCount,
      avgNext: Number(b.avgNext.toFixed(2)),
    })),
    bySource: {
      etf: sourceAccuracyToCtx(stats.bySource.etf),
      nav: sourceAccuracyToCtx(stats.bySource.nav),
      unknown: sourceAccuracyToCtx(stats.bySource.unknown),
    },
    daily: daily.map((d) => ({
      date: d.date,
      accuracy: d.accuracy != null ? Number((d.accuracy * 100).toFixed(1)) : null,
      sampleCount: d.sampleCount,
      avgNextChange: d.avgNextChange != null ? Number(d.avgNextChange.toFixed(2)) : null,
    })),
  };

  return `你是一位专业的量化投资与基金决策算法诊断专家。下面是一个基金评分决策引擎的回测验证数据：每天收盘记录每只基金的"买/持/卖"建议与综合评分(0-100)，并在次日回填实际涨跌，用以验证建议的真实方向性准确率。

## 回测统计汇总
${JSON.stringify(ctx, null, 2)}

## 最近样本（最多 ${MAX_SNAPSHOTS_FOR_PROMPT} 条，取最新）
${JSON.stringify(sample, null, 2)}

## 你的任务
基于以上数据，诊断该决策算法的薄弱环节，并给出可落地的调参/策略改进建议。重点分析（务必先区分「真异常」与「设计行为」，勿把设计行为误报为数据损坏）：

### A. 区分真异常 vs 设计行为
1. **方向性覆盖率(directionalCoverage)**：若偏低（如 <50%），说明大量快照是持有建议(neutral)，它们不会被计入命中率分母。此时「samples 出现 60-74 分但 buckets 中 60-70 区间 count=0」属**正常设计行为**——该区间高分样本全是持有、无方向性押注，不是数据损坏。请据此解释，而非报数据质量问题。
2. **数据质量真异常**：仅当单条 nextPct 超过 ±50%（如 -67% 这类单位换算错误）才属真异常；此时必须首先明确指出，并建议先修数据再重算。

### B. 算法有效性诊断
3. **市场方向伪信号检测（最重要）**：检查 daily 序列中 accuracy 与 avgNextChange 是否严格反相关（跌市 avgNextChange<0 时 accuracy 偏高、涨市偏低）。若是，说明当前高准确率大量来自「市场 beta 方向」而非算法预测力，需提示"准确率不可直接等同于择时能力"。
4. **买入侧覆盖度缺口**：buyHitRate 为 null（buyTotal=0）说明引擎在回测窗口从未给出买入建议。结合决策引擎阈值（风险上下文需 score>=70 且 bullRatio>=0.6 才买入）诊断是否过严导致永不买入，并给出放宽建议。
5. **区间单调性**：各评分区间命中率是否随评分升高而单调改善？是否存在"高分反亏"的反常区间？
6. **按建议次日平均涨跌**：buy/sell 的 avgNextByRec 是否印证评分方向有效；hold 的 avgNext 是否接近 0（持有确实中性）。
7. **增强维度贡献**：资金面/板块赛道/同类排名是否提升了区分度（对比 buckets 与整体准确率、或不同基金的 avgNext 差异）。
8. **场内ETF vs 净值K线对比（bySource）**：对比 etf 与 nav 两组的方向性准确率、样本量与 avgNext。重点判断：(a) 有场内ETF数据的基金（可走真实K线、评分不被压缩）与无ETF的净值基金，准确率是否显著不同；(b) 若 nav 组准确率与 etf 组接近，说明差异主要来自市场beta而非数据源质量；(c) unknown 组（取数失败被孤立）占比过高会高估整体准确率，需提示补全数据源。

### C. 输出
- weaknesses / suggestions 必须落到「可落地的阈值/权重/规则调整」，而非空泛结论。
- 若样本不足（settled 很小）请如实说明并给出"先积累数据"的建议。

## 输出要求
严格只输出一个 JSON 对象（不要 markdown 代码块包裹，不要任何其他文字）：
{
  "weaknesses": ["算法薄弱环节1", "薄弱环节2"],
  "suggestions": ["调参/策略建议1", "建议2"],
  "summary": "总体结论与优先级建议（中文，≤120字）"
}
其中 weaknesses / suggestions 为中文短句，每条≤40字；若样本不足请如实说明并给出"先积累数据"的建议。`;
}

/** AI 未配置时抛出，供 UI 引导去设置页 */
export class NoAIConfiguredError extends Error {
  constructor() {
    super("请先在设置页配置 AI API Key（默认 Provider）");
    this.name = "NoAIConfiguredError";
  }
}

function parseAnalysisJson(
  text: string,
): { weaknesses: string[]; suggestions: string[]; summary: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  const raw = m ? m[0] : text;
  try {
    const obj = JSON.parse(raw);
    if (
      Array.isArray(obj.weaknesses) &&
      Array.isArray(obj.suggestions) &&
      typeof obj.summary === "string"
    ) {
      return {
        weaknesses: obj.weaknesses.map(String),
        suggestions: obj.suggestions.map(String),
        summary: String(obj.summary),
      };
    }
  } catch {
    // 解析失败：保留 raw，由调用方决定降级
  }
  return null;
}

/**
 * 用已配置的 AI 分析回测数据，生成诊断并落库。
 * @param snapshots 全部快照（建议传 getAllSnapshots() 结果）
 * @returns 写入库的分析记录
 * @throws NoAIConfiguredError 未配置 AI；其他 Error 为调用/解析失败
 */
export async function analyzeBacktestWithAI(
  snapshots: ScoreSnapshot[],
): Promise<AiBacktestAnalysis> {
  const ai = getDefaultAI();
  if (!ai || !ai.apiKey) throw new NoAIConfiguredError();

  const stats = computeBacktestStats(snapshots);
  const daily = computeDailyAccuracySeries(snapshots);
  const prompt = buildBacktestAnalysisPrompt(stats, daily, snapshots);

  let raw: string;
  try {
    raw = await callAI(ai, [{ role: "user", content: prompt }]);
  } catch (e) {
    throw new Error(`AI 调用失败: ${e instanceof Error ? e.message : "未知错误"}`, { cause: e });
  }

  const parsed = parseAnalysisJson(raw);
  const analysis: AiBacktestAnalysis = {
    id: `ai-${Date.now()}`,
    date: localDateKey(),
    model: ai.model || ai.provider,
    provider: ai.provider,
    context: {
      total: stats.total,
      settled: stats.settled,
      directionalAccuracy: stats.directionalAccuracy,
      directionalCoverage: stats.directionalCoverage,
      buyHitRate: stats.buyHitRate,
      sellHitRate: stats.sellHitRate,
      avgNextByRec: stats.avgNextByRec,
      buckets: stats.buckets,
      daily,
      bySource: stats.bySource,
    },
    weaknesses: parsed?.weaknesses || [],
    suggestions: parsed?.suggestions || [],
    summary: parsed?.summary || "AI 返回格式无法解析，请查看原始内容或重试。",
    raw,
    createdAt: Date.now(),
  };
  await db.aiAnalyses.put(analysis);
  return analysis;
}

/** 读取全部 AI 分析记录（按生成时间倒序） */
export async function getAllAiAnalyses(): Promise<AiBacktestAnalysis[]> {
  return db.aiAnalyses.orderBy("createdAt").reverse().toArray();
}

/** 删除一条 AI 分析记录 */
export async function deleteAiAnalysis(id: string): Promise<void> {
  await db.aiAnalyses.delete(id);
}
