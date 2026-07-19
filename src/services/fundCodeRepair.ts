import { fetchFundCodeByNameCandidates, completeFundName, preferCClass } from '@/adapters/datasource/jsonp-utils'
import { fetchFundQuoteWithFallback } from '@/adapters/datasource/stock-api'

/**
 * 按基金名称修复代码（解决「导入截图只识别到名称、代码错配」问题）。
 *
 * 路径选择：
 * - 仅用东财 FundSearch 接口返回的基金代码候选，不再使用 AI 兜底（实测 AI
 *   对基金代码幻觉率高，不可靠）。
 * - 需要结合：1) 当前代码行情验证；2) 候选列表严格匹配，避免"电力"匹配"绿发电力"。
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
  source: 'api'
  reason?: string
}

const SIX_DIGIT = /^\d{6}$/
// 按「名称|当前码」缓存，避免同一基金在批量/重复检测时连发请求
const nameCache = new Map<string, FundCodeRepairSuggestion | null>()

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

/**
 * 清洗基金名称，去掉通用词、括号等，保留「公司名 + 核心主题词」并单独提取份额后缀(A/C/E)。
 * 东财 FundSearch 对完整长名称支持不好，必须缩短关键词才能命中；
 * 但 A/C 类份额后缀必须保留，否则 C 类用户会被推荐成 A 类。
 */
function cleanFundName(name: string): { keyword: string; shareClass: string } {
  const normalized = name
    .replace(/[（(].*?[）)]/g, '') // 去掉括号及内容（括号里通常含 QDII/人民币等，会破坏搜索）
    .replace(/\s+/g, '')

  // 提取末尾 A/C/E 份额标识（如 "A类" / "C" / "E份额"）
  const shareClassMatch = normalized.match(/([ACE])(?:类|份额)?$/)
  const shareClass = shareClassMatch ? shareClassMatch[1] : ''

  const keyword = normalized
    .replace(/主题指数|指数基金|指数|主题/g, '') // "主题"也是基金名通用词，必须去掉
    .replace(/中证/g, '') // 基金简称通常不含“中证”
    .replace(/发起式|发起|ETF|联接|连接|人民币|美元|现汇|现钞|QDII|FOF/g, '')
    .replace(/混合|股票|债券/g, '')
    .replace(/[ACE](?:类|份额)?$/g, '') // 去掉末尾份额标识
    .replace(/发起/g, '') // 兜底：去掉可能残留的"发起"
    .trim()

  return { keyword, shareClass }
}

/** 从基金名称中识别 A/C/E 份额后缀 */
function extractShareClass(name: string): string {
  const n = name
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
  const m = n.match(/([ACE])(?:类|份额)?$/)
  return m ? m[1] : ''
}

/** 按份额后缀重新排序候选：同份额优先，无份额其次，不同份额最后 */
function sortByShareClass(candidates: FundCodeCandidate[], shareClass: string): FundCodeCandidate[] {
  if (!shareClass || candidates.length <= 1) return candidates
  const rank = (name: string) => {
    const cls = extractShareClass(name)
    if (cls === shareClass) return 2
    if (!cls) return 1
    return 0
  }
  return [...candidates].sort((a, b) => {
    const ra = rank(a.name)
    const rb = rank(b.name)
    if (ra !== rb) return rb - ra
    return b.score - a.score
  })
}

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

  // 补全被截断的基金名称（如截图识别截断：结尾带…或不完整后缀词）。
  // 截断名补全后再提取份额后缀并反查，与导入路径一致，未明确份额时默认 C 类优先。
  const completedName = await completeFundName(n)
  // 清洗后的搜索关键词（去掉通用词、括号），保留公司名+核心主题和 A/C 份额后缀
  const { keyword: searchName, shareClass } = cleanFundName(completedName)
  const originalShareClass = shareClass || extractShareClass(completedName)

  let result: FundCodeRepairSuggestion | null = null

  // 1. 先验证当前代码是否有效。有效则大概率无需修复，避免误报。
  const currentValid = code ? await validateFundCode(code) : false

  // 2. 名称反查候选列表（已按匹配分数排序）
  const candidates = await fetchFundCodeByNameCandidates(searchName)
  // 3. 按份额后缀排序：明确 A/C/E → 同份额优先；未明确（含截断无法判定）→ 默认 C 类优先
  const ranked = originalShareClass
    ? sortByShareClass(candidates, originalShareClass)
    : preferCClass(candidates)
  const top = ranked[0]

  if (currentValid) {
    // 当前代码行情正常：基本视为正确。
    // 仅当名称反查 top 候选与当前码不一致，且匹配分数极高时，提示可能是同基金不同份额/新旧代码。
    // 若用户名称明确带 A/C 份额，且 top 候选份额一致，则阈值放宽（0.85），更容易纠偏“买C但代码是A”的情况。
    const topShareClass = top ? extractShareClass(top.name) : ''
    const sameShareClass = originalShareClass && topShareClass === originalShareClass
    const scoreThreshold = sameShareClass ? 0.85 : 0.95
    if (top && top.code !== code && top.score >= scoreThreshold) {
      const suggestedValid = await validateFundCode(top.code)
      result = {
        id: '',
        name: n,
        currentCode: code,
        suggestedCode: top.code,
        suggestedName: top.name,
        confidence: sameShareClass ? 0.85 : 0.6,
        verified: suggestedValid,
        source: 'api',
        reason: `当前代码 ${code} 可取行情，但名称反查最佳匹配为「${top.name}」，可能是同基金不同份额或旧代码，请核对`,
      }
    }
  } else {
    // 当前代码无效/无行情：必须修复。只取高置信候选，避免误取第一条无关基金。
    // 同份额候选放宽阈值，优先保证用户买到的份额不被改成另一份额。
    const topShareClass = top ? extractShareClass(top.name) : ''
    const sameShareClass = originalShareClass && topShareClass === originalShareClass
    const scoreThreshold = sameShareClass ? 0.6 : 0.75
    if (top && top.score >= scoreThreshold) {
      const suggestedValid = await validateFundCode(top.code)
      result = {
        id: '',
        name: n,
        currentCode: code,
        suggestedCode: top.code,
        suggestedName: top.name,
        confidence: sameShareClass ? Math.max(0.85, top.score) : top.score,
        verified: suggestedValid,
        source: 'api',
        reason: suggestedValid
          ? `当前代码 ${code || '空'} 无法获取行情，名称反查推荐「${top.name}」且行情验证通过`
          : `当前代码 ${code || '空'} 无法获取行情，名称反查推荐「${top.name}」，但建议码行情验证失败，请人工核对`,
      }
    }
    // 接口无高置信候选 → 不再使用 AI 兜底，直接返回 null（无建议）
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
