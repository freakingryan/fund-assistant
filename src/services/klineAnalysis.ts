/**
 * K 线形态分析 — AI 驱动
 *
 * 工作流程：
 * 1. 算法预检测（L1+L2+L3）获得形态列表
 * 2. 构建含真实 K 线 OHLC 数据 + 预检测形态的 Prompt
 * 3. 调用已配置的 AI Provider 做深度分析
 * 4. 解析 JSON 结果返回
 */
import { getDefaultAI } from './ai'
import { formatPatternsSummary, detectPatterns, extractFeatures } from './klinePatterns'
import type { KLineData } from '../types'
import type { AIConfig } from '../types'

// ─── 类型定义 ─────────────────────────────────────────

export interface KlineAnalysisRequest {
  code: string
  name: string
  klineData: KLineData[]
  period: string
  costNAV?: number
  currentNAV?: number
  shares?: number
}

export interface KlineAnalysisResult {
  trend: 'bullish' | 'bearish' | 'neutral'
  patterns: string
  advice: string
  confidence: 'high' | 'medium' | 'low'
  support?: number
  resistance?: number
}

// ─── Prompt 构建 ─────────────────────────────────────

function buildAnalysisPrompt(req: KlineAnalysisRequest): string {
  const { code, name, klineData, period, costNAV, currentNAV, shares } = req

  // 算法预检测形态
  const detectedPatterns = detectPatterns(klineData)
  const patternsSummary = formatPatternsSummary(detectedPatterns, klineData)

  // 格式化最近的 K 线数据（最多 30 根）
  const recentData = klineData.slice(-30)
  const header = '日期 | 开盘 | 收盘 | 最高 | 最低 | 成交量'
  const separator = '--- | --- | --- | --- | --- | ---'
  const rows = recentData.map(
    (d) => `${d.date} | ${d.open.toFixed(4)} | ${d.close.toFixed(4)} | ${d.high.toFixed(4)} | ${d.low.toFixed(4)} | ${d.volume || 0}`,
  )
  const klineTable = [header, separator, ...rows].join('\n')

  // L1 特征摘要
  const features = recentData.map(extractFeatures)
  const bullishCount = features.filter((f) => f.isBullish).length
  const bearishCount = features.length - bullishCount
  const avgBody = features.reduce((s, f) => s + f.bodyRatio, 0) / features.length
  const avgUpper = features.reduce((s, f) => s + f.upperRatio, 0) / features.length
  const avgLower = features.reduce((s, f) => s + f.lowerRatio, 0) / features.length

  const featureSummary =
    `近${recentData.length}日特征：阳线 ${bullishCount} 根 / 阴线 ${bearishCount} 根，` +
    `平均实体占比 ${(avgBody * 100).toFixed(1)}%，` +
    `平均上影线占比 ${(avgUpper * 100).toFixed(1)}%，` +
    `平均下影线占比 ${(avgLower * 100).toFixed(1)}%`

  // 持仓信息
  let positionInfo = '无持仓信息'
  if (costNAV !== undefined && currentNAV !== undefined && shares !== undefined) {
    const profit = (currentNAV - costNAV) * shares
    const profitRatio = ((currentNAV - costNAV) / costNAV * 100).toFixed(2)
    positionInfo =
      `持有 ${shares} 份，持仓成本 ¥${costNAV.toFixed(4)}，` +
      `当前净值 ¥${currentNAV.toFixed(4)}，` +
      `浮动盈亏 ¥${profit.toFixed(2)}（${profitRatio}%）`
  }

  return `你是一位资深 A 股技术分析专家。请分析以下 ETF 最近 ${recentData.length} 个交易日的 K 线数据：

## 基金信息
- 名称/代码：${name}（${code}）
- 周期：${period}

## 算法预检测到的 K 线形态
${patternsSummary}

## 特征摘要
${featureSummary}

## K 线原始数据（OHLC）
${klineTable}

## 用户持仓
${positionInfo}

## 分析要求
请分析以下内容，以 JSON 格式返回（不要其他内容）：

1. 当前趋势判断：bullish（多头）/ bearish（空头）/ neutral（震荡）
2. 识别的 K 线形态：简要说明您识别的关键技术形态
3. 投资建议（结合用户持仓）：
   - 如果近期大跌：是调整买入机会还是趋势反转？
   - 如果近期大涨：应该止盈还是继续持有？
   - 当前是否适合补仓或减仓？
4. 置信度：high / medium / low
5. 关键价位：支撑位和阻力位的具体数值

返回格式：
{
  "trend": "bullish|bearish|neutral",
  "patterns": "识别出的形态文本描述",
  "advice": "具体的投资建议，中文",
  "confidence": "high|medium|low",
  "support": 支撑位数值,
  "resistance": 阻力位数值
}`
}

// ─── AI 调用 ─────────────────────────────────────────

/**
 * 调用 AI 进行 K 线形态分析
 * 如果未配置 AI Provider，返回纯算法检测结果作为降级方案
 */
export async function analyzeKline(
  request: KlineAnalysisRequest,
): Promise<{ result: KlineAnalysisResult; usedAI: boolean; error?: string }> {
  // 1. 算法检测（始终运行）
  const patterns = detectPatterns(request.klineData)
  const patternsSummary = formatPatternsSummary(patterns, request.klineData)

  // 2. 尝试 AI 增强分析
  const ai = getDefaultAI()
  if (!ai || !ai.apiKey) {
    return {
      result: {
        trend: 'neutral',
        patterns: patternsSummary,
        advice: '未配置 AI API，仅提供形态检测结果。请前往设置页配置 AI Provider 后获取深度分析。',
        confidence: 'low',
        support: request.klineData.reduce((min, d) => Math.min(min, d.low), Infinity),
        resistance: request.klineData.reduce((max, d) => Math.max(max, d.high), -Infinity),
      },
      usedAI: false,
      error: '未配置 AI',
    }
  }

  // 3. 调用 AI
  try {
    const prompt = buildAnalysisPrompt(request)
    const response = await callAI(ai, [{ role: 'user', content: prompt }])
    const json = parseJsonResponse(response)
    if (json && isValidResult(json)) {
      return {
        result: {
          ...json,
          patterns: json.patterns || patternsSummary,
        },
        usedAI: true,
      }
    }
    throw new Error('AI 返回格式异常')
  } catch (e) {
    return {
      result: {
        trend: 'neutral',
        patterns: patternsSummary,
        advice: `AI 分析失败: ${e instanceof Error ? e.message : '未知错误'}。请检查 AI Provider 配置。`,
        confidence: 'low',
        support: request.klineData.reduce((min, d) => Math.min(min, d.low), Infinity),
        resistance: request.klineData.reduce((max, d) => Math.max(max, d.high), -Infinity),
      },
      usedAI: false,
      error: e instanceof Error ? e.message : '未知错误',
    }
  }
}

// ─── AI API 调用（复用） ─────────────────────────────

async function callAI(
  config: AIConfig,
  messages: { role: string; content: string }[],
): Promise<string> {
  const { provider, apiKey, baseURL, model } = config

  const endpoints: Record<string, string> = {
    deepseek: baseURL || 'https://api.deepseek.com/v1/chat/completions',
    openai: baseURL || 'https://api.openai.com/v1/chat/completions',
    groq: baseURL || 'https://api.groq.com/openai/v1/chat/completions',
    openrouter: baseURL || 'https://openrouter.ai/api/v1/chat/completions',
    google: baseURL || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    custom: baseURL || 'https://api.openai.com/v1/chat/completions',
  }

  const defaultModels: Record<string, string> = {
    deepseek: model || 'deepseek-chat',
    openai: model || 'gpt-4o',
    groq: model || 'llama-3.3-70b-versatile',
    openrouter: model || 'openai/gpt-4o',
    google: 'gemini-2.0-flash',
    custom: model || 'gpt-4o',
  }

  const finalMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  if (provider === 'google') {
    const res = await fetch(endpoints[provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        contents: finalMessages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `Google API error: ${res.status}`)
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }

  const res = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: defaultModels[provider],
      messages: finalMessages,
      temperature: 0.1,
      max_tokens: 2000,
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `API error: ${res.status}`)
  return data.choices?.[0]?.message?.content || ''
}

// ─── 解析工具 ─────────────────────────────────────────

function parseJsonResponse(response: string): Record<string, unknown> | null {
  // Try direct parse
  const trimmed = response.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch { /* try regex */ }
  }

  // Try extracting JSON from markdown code block
  const codeMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeMatch) {
    try {
      return JSON.parse(codeMatch[1])
    } catch { /* continue */ }
  }

  // Try generic JSON extract
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch { /* give up */ }
  }

  return null
}

function isValidResult(obj: unknown): obj is KlineAnalysisResult {
  if (!obj || typeof obj !== 'object') return false
  const r = obj as Record<string, unknown>
  return (
    typeof r.trend === 'string' &&
    ['bullish', 'bearish', 'neutral'].includes(r.trend) &&
    typeof r.advice === 'string' &&
    typeof r.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(r.confidence)
  )
}
