import { fetchFundCodeByNameCandidates } from '@/adapters/datasource/jsonp-utils'
import { fetchFundQuoteWithFallback } from '@/adapters/datasource/stock-api'
import { getDefaultAI, callAI } from '@/services/ai'

/**
 * 按基金名称修复代码（解决「导入截图只识别到名称、代码错配」问题）。
 *
 * 路径选择（回答"接口还是 AI 更准确"）：
 * - 主路径用接口：东财 FundSearch 返回真实基金代码候选，但它是模糊搜索，需要
 *   二次匹配过滤才能避免"电力"匹配"绿发电力"这种错误。因此必须结合：
 *     1) 当前代码行情验证：只有当前代码无法获取行情时，才认为需要修复；
 *     2) 候选列表严格匹配：仅当候选 score >= 0.75 才采用，避免取到第一条无关基金。
 * - 兜底用 AI：仅当接口无高置信候选且已配置 AI 时，用 LLM 推测；标记为「未验证」，
 *   因为 AI 没有实时基金库、可能给出不存在的码，须人工审阅后才应用。
 *
 * 限流：接口为公开 JSONP/净值端点，逐条串行 + 间隔（默认 300ms）+ 按「名称|当前码」缓存，
 * 避免批量连发触发风控。
 */

export interface FundCodeRepairSuggestion {
  id: string // 持仓 id（批量时由调用方回填）
  name: string // 持仓当前名称（正确）
  currentCode: string // 持仓当前代码（疑似错误）
  suggestedCode: string // 建议代码
  suggestedName: string // 建议名称
  confidence: number // 0-1
  verified: boolean // 建议码已做行情验证=True；AI 推测/未验证=False
  source: 'api' | 'ai'
  reason?: string
}

const SIX_DIGIT = /^\d{6}$/
// 按「名称|当前码」缓存，避免同一基金在批量/重复检测时连发请求
const nameCache = new Map<string, FundCodeRepairSuggestion | null>()

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** 验证基金代码是否真实可交易：能取到最新净值且净值 > 0 */
async function validateFundCode(code: string): Promise<boolean> {
  if (!SIX_DIGIT.test(code)) return false
  try {
    const q = await fetchFundQuoteWithFallback(code)
    return q !== null && q.nav > 0
  } catch {
    return false
  }
}

/**
 * 单条：根据基金名称修复代码。
 * 返回 null 表示「无需修复」（当前代码可取行情且与名称匹配，或接口无高置信候选且无 AI）。
 */
export async function recommendFundCodeFix(
  name: string,
  currentCode?: string,
): Promise<FundCodeRepairSuggestion | null> {
  const n = (name || '').trim()
  if (n.length < 2) return null
  const code = (currentCode || '').trim()
  const cacheKey = `${n}|${code}`
  if (nameCache.has(cacheKey)) return nameCache.get(cacheKey) ?? null

  let result: FundCodeRepairSuggestion | null = null

  // 1. 先验证当前代码是否有效。有效则大概率无需修复，避免误报。
  const currentValid = code ? await validateFundCode(code) : false

  // 2. 名称反查候选列表（已按匹配分数排序）
  const candidates = await fetchFundCodeByNameCandidates(n)
  const top = candidates[0]

  if (currentValid) {
    // 当前代码行情正常：基本视为正确。
    // 仅当名称反查 top 候选与当前码不一致，且匹配分数极高（>=0.95）时，
    // 提示可能是同基金不同份额/新旧代码，让用户核对。
    if (top && top.code !== code && top.score >= 0.95) {
      const suggestedValid = await validateFundCode(top.code)
      result = {
        id: '',
        name: n,
        currentCode: code,
        suggestedCode: top.code,
        suggestedName: top.name,
        confidence: 0.6,
        verified: suggestedValid,
        source: 'api',
        reason: `当前代码 ${code} 可取行情，但名称反查最佳匹配为「${top.name}」，可能是同基金不同份额或旧代码，请核对`,
      }
    }
  } else {
    // 当前代码无效/无行情：必须修复。只取高置信候选（>=0.75），避免误取第一条无关基金。
    if (top && top.score >= 0.75) {
      const suggestedValid = await validateFundCode(top.code)
      result = {
        id: '',
        name: n,
        currentCode: code,
        suggestedCode: top.code,
        suggestedName: top.name,
        confidence: top.score,
        verified: suggestedValid,
        source: 'api',
        reason: suggestedValid
          ? `当前代码 ${code || '空'} 无法获取行情，名称反查推荐「${top.name}」且行情验证通过`
          : `当前代码 ${code || '空'} 无法获取行情，名称反查推荐「${top.name}」，但建议码行情验证失败，请人工核对`,
      }
    } else {
      // 接口无高置信候选 → AI 兜底（须已配置 AI）
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
              const suggestedCode = String(p.code)
              const suggestedValid = await validateFundCode(suggestedCode)
              result = {
                id: '',
                name: n,
                currentCode: code,
                suggestedCode,
                suggestedName: String(p.name || n),
                confidence: 0.5,
                verified: suggestedValid,
                source: 'ai',
                reason: suggestedValid
                  ? 'AI 推测，建议码经行情接口二次验证通过'
                  : 'AI 推测，建议码行情验证失败，请重点核对',
              }
            }
          }
        } catch {
          /* AI 失败则无建议 */
        }
      }
    }
  }

  nameCache.set(cacheKey, result)
  return result
}

/**
 * 批量修复：串行处理 + 间隔，规避数据源连发限流；按名称缓存去重。
 * 返回所有非空（即代码与名称不匹配或可能为不同份额）的修复建议。
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
