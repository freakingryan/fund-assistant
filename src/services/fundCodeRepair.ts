import { fetchFundCodeByName } from '@/adapters/datasource/jsonp-utils'
import { getDefaultAI, callAI } from '@/services/ai'

/**
 * 按基金名称修复代码（解决「导入截图只识别到名称、代码错配」问题）。
 *
 * 路径选择（回答"接口还是 AI 更准确"）：
 * - 主路径用接口（东财 FundSearch，fetchFundCodeByName）：返回真实在市基金的 6 位代码，
 *   确定性、准确、不会幻觉；这是权威来源。
 * - 兜底用 AI：仅当接口无结果且已配置 AI 时，用 LLM 推测；标记为「未验证」，
 *   因为 AI 没有实时基金库、可能给出不存在的码，须人工审阅后才应用。
 *
 * 限流：接口为公开 JSONP 端点，逐条串行 + 间隔（默认 300ms）+ 按「名称|当前码」缓存，
 * 避免批量连发触发风控。
 */

export interface FundCodeRepairSuggestion {
  id: string // 持仓 id（批量时由调用方回填）
  name: string // 持仓当前名称（正确）
  currentCode: string // 持仓当前代码（疑似错误）
  suggestedCode: string // 建议代码
  suggestedName: string // 建议名称
  confidence: number // 0-1
  verified: boolean // 经权威接口确认=True；AI 推测=False
  source: 'api' | 'ai'
  reason?: string
}

const SIX_DIGIT = /^\d{6}$/
// 按「名称|当前码」缓存，避免同一基金在批量/重复检测时连发请求
const nameCache = new Map<string, FundCodeRepairSuggestion | null>()

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** 名称相似度（粗略）：完全相等→1；互相包含→0.92；否则按公共字符比例（下限 0.5） */
function nameSimilarity(a: string, b: string): number {
  const x = (a || '').trim()
  const y = (b || '').trim()
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.92
  const setA = new Set(x)
  let common = 0
  for (const ch of setA) if (y.includes(ch)) common++
  return Math.max(0.5, common / Math.max(setA.size, new Set(y).size))
}

/**
 * 单条：根据基金名称修复代码。
 * 返回 null 表示「无需修复」（接口无结果且无 AI，或当前代码已与名称匹配）。
 */
export async function recommendFundCodeFix(
  name: string,
  currentCode?: string,
): Promise<FundCodeRepairSuggestion | null> {
  const n = (name || '').trim()
  if (n.length < 2) return null
  const cacheKey = `${n}|${currentCode?.trim() || ''}`
  if (nameCache.has(cacheKey)) return nameCache.get(cacheKey) ?? null

  let result: FundCodeRepairSuggestion | null = null
  try {
    const hit = await fetchFundCodeByName(name)
    if (hit && hit.code) {
      // 当前代码已与名称匹配 → 无需修复
      if (currentCode && hit.code === currentCode.trim()) {
        result = null
      } else {
        result = {
          id: '',
          name: n,
          currentCode: currentCode || '',
          suggestedCode: hit.code,
          suggestedName: hit.name || n,
          confidence: nameSimilarity(n, hit.name || n),
          verified: true,
          source: 'api',
        }
      }
    } else {
      // 接口无结果 → AI 兜底（须已配置）
      const ai = getDefaultAI()
      if (ai) {
        try {
          const resp = await callAI(ai, [
            {
              role: 'user',
              content: `你是中国公募基金数据库。已知一只场外公募基金的名称是"${n}"。请给出它对应的 6 位基金代码与完整名称。只输出严格 JSON：{"code":"6位代码","name":"完整名称"}，不要其他文字。`,
            },
          ])
          const m = resp.match(/\{[\s\S]*\}/)
          if (m) {
            const p = JSON.parse(m[0])
            if (p?.code && SIX_DIGIT.test(String(p.code))) {
              result = {
                id: '',
                name: n,
                currentCode: currentCode || '',
                suggestedCode: String(p.code),
                suggestedName: String(p.name || n),
                confidence: 0.5,
                verified: false,
                source: 'ai',
                reason: 'AI 推测，未经接口验证',
              }
            }
          }
        } catch {
          /* AI 失败则无建议 */
        }
      }
    }
  } catch {
    result = null
  }
  nameCache.set(cacheKey, result)
  return result
}

/**
 * 批量修复：串行处理 + 间隔，规避数据源连发限流；按名称缓存去重。
 * 返回所有非空（即代码与名称不匹配）的修复建议。
 */
export async function recommendFundCodeFixes(
  holdings: { id: string; name: string; code: string }[],
  opts: { onProgress?: (done: number, total: number) => void; delayMs?: number } = {},
): Promise<FundCodeRepairSuggestion[]> {
  const delayMs = opts.delayMs ?? 300
  const out: FundCodeRepairSuggestion[] = []
  const total = holdings.length
  let done = 0
  const seen = new Set<string>() // 同名称只查一次
  for (const h of holdings) {
    const key = h.name?.trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      const s = await recommendFundCodeFix(key, h.code)
      if (s) out.push({ ...s, id: h.id, name: h.name, currentCode: h.code })
    }
    done++
    opts.onProgress?.(done, total)
    if (done < total) await wait(delayMs)
  }
  return out
}
