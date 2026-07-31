/**
 * 观点回测 · 观点分析与方向抽取
 *
 * 两种输入形态收敛到同一 `InvestmentDirection[]` + `fullText`：
 *  - Case A · ima 已分析（`extractDirections`）：轻量启发式，从 ima 返回的分析结论里
 *    捞「主题 + 买卖建议 + 一句话理由」成卡片；不再跑完整 callAI（避免重复、ima 已给结论）。
 *  - Case B · 原始观点（`analyzeInsight`）：用 `callAI` 做结构化抽取（JSON schema 约束
 *    directions[] + 整体建议），结合当日市场快照上下文。
 *
 * 两条链路都经 `themeMappings` 把主题关键词回填到可回测的 ETF/指数代码（mappedCodes）。
 *
 * @module services/insightAnalysis
 */

import type { InvestmentDirection, MarketSnapshot, ThemeMapping } from "@/types";
import { getDefaultAI, callAI } from "@/services/ai";

/** 生成稳定且唯一的卡片 id（优先 crypto.randomUUID） */
function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * 把主题/理由文本中的关键词匹配到映射标的代码（可回测落点）。
 * 命中口径：主题 id、展示名 label、以及用户配置的别名 aliases 三者任一。
 * （博主用词常与主题名不一致，如「芯片」之于「半导体」，只匹配 id 会大量漏配。）
 */
function resolveMappedCodes(text: string, mappings: ThemeMapping[]): string[] {
  const codes: string[] = [];
  for (const m of mappings) {
    const keys = [m.id, m.label, ...(m.aliases ?? [])].filter(
      (k): k is string => !!k && k.trim().length > 0,
    );
    if (keys.some((k) => text.includes(k))) codes.push(...m.codes);
  }
  return Array.from(new Set(codes));
}

/** 从理由文本推断买卖方向 */
function detectDirection(text: string): InvestmentDirection["direction"] {
  if (/(建仓|买入|加仓|布局|逢低|抄底|配置|买点|做多|吸筹|低吸|吸纳)/.test(text)) return "buy";
  if (/(卖出|减仓|清仓|规避|回避|不碰|离场|止盈|做空|高抛|减)/.test(text)) return "sell";
  return "hold";
}

/** 从理由文本抽取结构级别（如 60分钟上涨结构 / 周线） */
function detectLevel(text: string): string | undefined {
  const m = text.match(
    /(\d+分钟|(日|周|月)线|上涨结构|下跌结构|横盘|磨底|企稳|反转|突破|回踩|半年线|年线)/,
  );
  return m ? m[0] : undefined;
}

/** 元信息行（操作总策略 / 风险提示等）不抽成方向卡片，仅留在 fullText */
const META_THEME_RE = /^(操作|总策略|策略|风险提示|风险|注意|总结|小结|建议|结论)$/;

/**
 * 条目行匹配：兼容 ima 常见的三种排版
 *  - `- 主题：建议` / `· 主题：建议`（子弹点）
 *  - `1. 主题：建议` / `1) 主题：建议`（有序列表，ima 输出很常见）
 *  - `【主题】建议`（方括号标题式，无冒号）
 *  - `### 主题：建议`（markdown 小标题）
 * 无标记裸行（`主题：建议`）不收，避免把正文叙述句误抽成卡片。
 */
const BULLET_RE = /^\s*(?:[-*·•]|\d+[.、)])\s*([^:：]+?)\s*[:：]\s*(.+)$/;
const BRACKET_RE = /^\s*[【[]\s*([^】\]]+?)\s*[】\]]\s*[:：]?\s*(.+)$/;
const HEADING_RE = /^\s*#+\s*([^:：]+?)\s*[:：]\s*(.+)$/;

/** 主题名超过这个长度基本是叙述句而非主题，丢弃以免污染卡片 */
const MAX_THEME_LEN = 14;

/**
 * Case A · 轻量方向抽取（ima 已分析结论）。
 * 解析条目行（子弹点 / 有序列表 / 【主题】）；无结构化内容时退化为单条整体卡片。
 */
export function extractDirections(text: string, mappings: ThemeMapping[]): InvestmentDirection[] {
  const lines = text.split(/\r?\n/);
  const dirs: InvestmentDirection[] = [];

  for (const rawLine of lines) {
    // 去掉 markdown 加粗星号，便于解析 **主题**： 形态
    const line = rawLine.replace(/\*/g, "");
    const bullet = line.match(BULLET_RE) ?? line.match(BRACKET_RE) ?? line.match(HEADING_RE);
    if (!bullet) continue;
    const theme = bullet[1].trim();
    const brief = bullet[2].trim();
    if (theme.length < 1 || theme.length > MAX_THEME_LEN || brief.length < 2) continue;
    if (META_THEME_RE.test(theme)) continue; // 元信息行不抽卡
    dirs.push({
      id: rid(),
      theme,
      direction: detectDirection(`${theme} ${brief}`),
      brief,
      level: detectLevel(brief),
      mappedCodes: resolveMappedCodes(`${theme} ${brief}`, mappings),
    });
  }

  if (dirs.length === 0) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
    dirs.push({
      id: rid(),
      theme: "整体观点",
      direction: detectDirection(text),
      brief: snippet || "（无结构化内容）",
      mappedCodes: resolveMappedCodes(text, mappings),
    });
  }
  return dirs;
}

export interface AnalyzeResult {
  directions: InvestmentDirection[];
  advice: string;
}

/**
 * Case B · 完整抽取（原始观点）。用 callAI 结合当日市场快照做结构化抽取。
 * @param raw 原始观点文本
 * @param snapshot 当日市场快照（上下文）
 * @param mappings 主题→ETF/指数映射
 * @param aiCfg 可选 AI 配置；缺省用设置里的默认 AI
 */
export async function analyzeInsight(
  raw: string,
  snapshot: MarketSnapshot,
  mappings: ThemeMapping[],
  aiCfg?: Parameters<typeof callAI>[0],
): Promise<AnalyzeResult> {
  const ai = aiCfg ?? getDefaultAI();
  if (!ai) throw new Error("请先在设置页配置 AI API Key（用于观点结构化分析）。");

  const snapText = JSON.stringify({
    date: snapshot.date,
    indexes: snapshot.indexes,
    relatedEtfs: snapshot.relatedEtfs,
  });
  const mappingHint = mappings
    .map((m) => {
      const alias = (m.aliases ?? []).filter(Boolean);
      const name = alias.length > 0 ? `${m.id}(别名:${alias.join("/")})` : m.id;
      return `${name}→[${m.codes.join(",")}]`;
    })
    .join("; ");

  const prompt = `你是中国 A 股投资分析助手。下面是某博主的投资观点原文，以及观点所属交易日(${snapshot.date})的市场快照（宽基+相关ETF涨跌%）。
请结合市场动向，抽取其中的具体投资方向，并给出整体操作建议。

# 市场快照（${snapshot.date}）
${snapText}

# 主题→可回测标的映射提示（命中主题关键词时回填 mappedCodes）
${mappingHint}

# 博主观点原文
${raw}

# 输出要求
严格只返回一个 JSON 对象（不要 markdown 包裹、不要额外文字），结构如下：
{
  "directions": [
    {"theme":"主题名","direction":"buy|sell|hold","brief":"一句话操作建议","level":"可选结构级别如60分钟上涨结构"}
  ],
  "advice":"整体投资建议（中文，2-4句）"
}
注意：directions 按原文实际观点来（一般 3-8 条）；brief 要简洁可执行；level 可省略。
theme 命名尽量复用上面「主题→标的映射提示」里的主题名（原文用别名时也归一到主题名），这样才能落到可回测标的。`;

  const response = await callAI(ai, [{ role: "user", content: prompt }]);
  let parsed: { directions?: unknown; advice?: unknown } | null = null;
  try {
    const m = response.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch {
    /* ignore */
  }
  if (!parsed || !Array.isArray(parsed.directions) || parsed.directions.length === 0) {
    throw new Error("AI 未能返回结构化结果，请重试或改用「粘贴文本（已分析）」模式。");
  }

  const directions: InvestmentDirection[] = (parsed.directions as unknown[]).map((d) => {
    const o = (d ?? {}) as {
      theme?: unknown;
      direction?: unknown;
      brief?: unknown;
      level?: unknown;
    };
    const theme = String(o.theme ?? "未命名");
    const brief = String(o.brief ?? "");
    const dir: InvestmentDirection["direction"] = ["buy", "sell", "hold"].includes(
      o.direction as string,
    )
      ? (o.direction as InvestmentDirection["direction"])
      : "hold";
    return {
      id: rid(),
      theme,
      direction: dir,
      brief,
      level: o.level ? String(o.level) : undefined,
      mappedCodes: resolveMappedCodes(`${theme} ${brief}`, mappings),
    };
  });

  return { directions, advice: String(parsed.advice ?? "") };
}
