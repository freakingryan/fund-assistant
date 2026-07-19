import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import type { AIConfig } from '@/types'

/**
 * 调用 AI API 的通用函数
 */
async function callAI(
  config: AIConfig,
  messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[],
): Promise<string> {
  const { provider, apiKey, baseURL, model } = config

  const endpoints: Record<string, string> = {
    deepseek: baseURL || 'https://api.deepseek.com/v1/chat/completions',
    openai: baseURL || 'https://api.openai.com/v1/chat/completions',
    groq: baseURL || 'https://api.groq.com/openai/v1/chat/completions',
    openrouter: baseURL || 'https://openrouter.ai/api/v1/chat/completions',
    agnes: baseURL || 'https://apihub.agnes-ai.com/v1/chat/completions',
    google: baseURL || `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent`,
    custom: baseURL || 'https://api.openai.com/v1/chat/completions',
  }

  const defaultModels: Record<string, string> = {
    deepseek: model || 'deepseek-chat',
    openai: model || 'gpt-4o',
    groq: model || 'llama-3.3-70b-versatile',
    openrouter: model || 'openai/gpt-4o',
    agnes: model || 'agnes-2.0-flash',
    google: 'gemini-2.0-flash',
    custom: model || 'gpt-4o',
  }

  if (provider === 'google') {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: Array.isArray(m.content)
        ? m.content.map((p) => {
            if (p.image_url) {
              const base64 = p.image_url.url.replace(/^data:image\/\w+;base64,/, '')
              return { inlineData: { mimeType: 'image/png', data: base64 } }
            }
            return { text: p.text || '' }
          })
        : [{ text: String(m.content) }],
    }))

    const res = await fetch(endpoints[provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,  // #1: header not URL param
      },
      body: JSON.stringify({ contents }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `Google API error: ${res.status}`)
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }

  // OpenAI-compatible API (DeepSeek, OpenAI, custom)
  const res = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: defaultModels[provider],
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.1,
      max_tokens: 2000,
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `API error: ${res.status}`)
  return data.choices?.[0]?.message?.content || ''
}

/**
 * 获取已配置的默认 AI
 */
function getDefaultAI(): AIConfig | null {
  const cfg = useSettingsStore.getState().settings.aiConfigs
  const defaultProvider = useSettingsStore.getState().settings.defaultAIProvider
  const ai = cfg.find((c) => c.provider === defaultProvider)
  return ai && ai.apiKey ? ai : cfg.find((c) => c.apiKey) || null
}

/**
 * 从图片中提取基金持仓信息（通过 AI Vision）
 *
 * 支持平台格式：
 * - 京东金融：基金名称 / 金额(持有市值) / 今日收益 / 持仓收益 / 收益率（代码不可见）
 * - 支付宝/蚂蚁财富：基金名称 / 持有金额 / 持有收益 / 今日收益
 * - 天天基金/蛋卷基金：基金代码+名称 / 持有份额 / 持有市值 / 持有收益
 * - 雪球/其他券商：基金名称或代码 / 仓位 / 盈亏
 */
export async function extractFundInfoFromImage(imageDataUrl: string): Promise<{
  holdings: Array<{
    code: string
    name: string
    costNAV: number
    shares: number
    holdingAmount: number
    holdingProfit: number
  }>
  raw: string
}> {
  const ai = getDefaultAI()
  if (!ai) throw new Error('请先在设置页配置 AI API Key')

  const prompt = `你是一个专业的基金持仓数据 OCR 提取助手。请从这张基金持仓截图中精确提取每只基金的信息。

## 截图可能来自以下平台，请自动识别并适配：
1. **京东金融** — 显示：基金名称、金额（持有市值）、今日收益、持仓收益、收益率；通常**不显示基金代码**
2. **支付宝/蚂蚁财富** — 显示：基金名称、持有金额、持有收益、今日收益、收益率
3. **天天基金/蛋卷基金** — 显示：基金代码、基金名称、持有份额、持有市值、持有收益
4. **雪球/券商 App** — 显示：基金名称或代码、持仓市值、盈亏/盈亏比例

## 提取规则：
- **基金名称 (name)**：必须提取完整准确的全称，不要省略
- **基金代码 (code)**：如果截图中有则提取（6 位数字）；如果没有则填空字符串 ""，不要猜测或编造
- **持有金额/市值 (holdingAmount)**：当前持有的总市值（元），即「金额」「持有金额」「持仓市值」等字段
- **持有收益 (holdingProfit)**：累计盈亏金额（元），正数=盈利，负数=亏损。即「持仓收益」「持有收益」「盈亏」等字段
- **持仓成本净值 (costNAV)**：如果有明确的成本单价则填写，否则填 0
- **持有份额 (shares)**：如果有明确的份额数据则填写，否则填 0

## 输出格式（严格 JSON，不要 markdown 包裹）：
{"holdings":[{"code":"基金代码或空串","name":"基金完整名称","holdingAmount":持有金额数字,"holdingProfit":持有收益数字,"costNAV":成本净值或0,"shares":份额或0}]}`


  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ]

  const response = await callAI(ai, messages)

  // Try to parse JSON from response
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        holdings: parsed.holdings || [],
        raw: response,
      }
    }
  } catch {
    // JSON parse failed, try to extract line by line
  }

  // Fallback: return raw text
  return { holdings: [], raw: response }
}

/**
 * 通过 AI 获取基金详情（仅根据基金代码）
 */
export async function fetchFundInfoByCode(code: string): Promise<{
  name: string
  type: string
  sector: string
  description: string
}> {
  const ai = getDefaultAI()
  if (!ai) throw new Error('请先在设置页配置 AI API Key')

  const prompt = `请查询基金代码 "${code}" 的详细信息。返回严格 JSON 格式：
{
  "name": "基金全称",
  "type": "股票型/混合型/债券型/指数型/QDII/货币型/ETF",
  "sector": "科技/消费/医药/新能源/金融/制造/宽基/全球/债市/大宗商品/其他",
  "description": "一句话简述基金投资方向"
}
只返回 JSON，不要其他内容。`

  const response = await callAI(ai, [
    { role: 'user', content: prompt },
  ])

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
  } catch {
    // fallback
  }

  return { name: code, type: 'stock', sector: 'other', description: '' }
}

/**
 * 通过数据源查询基金基本信息
 */
async function fetchFundInfoByDataSource(code: string): Promise<{
  name: string
  type: string
  sector: string
  description: string
} | null> {
  try {
    const info = await dataSourceService.fetchFundInfo(code)
    if (info && info.name !== code) {
      return {
        name: info.name,
        type: classifyType(info.name, info.type),
        sector: classifySector(info.name, info.type),
        description: `${info.name}（${info.type}）`,
      }
    }
  } catch { /* fallback to AI */ }
  return null
}

/**
 * 根据基金名称和类型推测投资领域
 */
function classifySector(name: string, type: string): string {
  const n = name.toLowerCase()
  if (n.includes('科技') || n.includes('信息') || n.includes('互联') || n.includes('半导体') || n.includes('芯片')) return 'tech'
  if (n.includes('消费') || n.includes('白酒') || n.includes('食品') || n.includes('饮料') || n.includes('家电')) return 'consumer'
  if (n.includes('医') || n.includes('药') || n.includes('健康') || n.includes('生物')) return 'healthcare'
  if (n.includes('新能源') || n.includes('光伏') || n.includes('环保') || n.includes('碳中和') || n.includes('电池')) return 'new_energy'
  if (n.includes('金融') || n.includes('银行') || n.includes('证券') || n.includes('保险') || n.includes('地产')) return 'finance'
  if (n.includes('制造') || n.includes('工业') || n.includes('军工') || n.includes('机械') || n.includes('汽车')) return 'manufacturing'
  if (n.includes('债券') || n.includes('债') || n.includes('纯债') || n.includes('中短债')) return 'bond_market'
  if (n.includes('全球') || n.includes('海外') || n.includes('美国') || n.includes('纳斯达克') || n.includes('标普') || n.includes('恒生') || n.includes('日经') || n.includes('德国')) return 'global'
  if (type === '指数型' || type === 'index' || n.includes('指数')) return 'broad_market'
  return 'other'
}

function classifyType(name: string, type: string): string {
  if (type && type !== '其他') return type
  const n = name
  if (n.includes('货币')) return '货币型'
  if (n.includes('债券') || n.includes('债')) return '债券型'
  if (n.includes('指数') || n.includes('ETF') || n.includes('联接')) return '指数型'
  if (n.includes('QDII')) return 'QDII'
  if (n.includes('混合') || n.includes('灵活')) return '混合型'
  return '股票型'
}

/**
 * 批量查询多个基金代码
 * 优先用数据源（东方财富 JSONP），查不到不编造数据，直接抛出明确的错误信息
 */
export async function fetchFundInfoByCodes(codes: string[]): Promise<
  Array<{
    code: string
    name: string
    type: string
    sector: string
    description: string
  }>
> {
  const results: Array<any> = []
  const failed: string[] = []

  for (const code of codes) {
    const info = await fetchFundInfoByDataSource(code)
    if (info) {
      results.push({ code, ...info })
    } else {
      failed.push(code)
    }
  }

  if (failed.length > 0) {
    throw new Error(`以下基金代码查询失败，请手动填写：${failed.join('、')}`)
  }

  return results
}

/**
 * 查询场外基金对应的场内 ETF 代码
 * 优先级：数据源匹配 → AI 查询
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface EtfMappingResult {
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
}

/**
 * 单只基金查询：数据源优先，失败再用单只 AI 兜底。
 * 适用「重新查询」「手动添加」等单条场景。
 * 批量场景请用 fetchEtfMappings（统一批量 AI 兜底，性能更好）。
 */
export async function fetchEtfMapping(
  otcCode: string,
  otcName?: string,
): Promise<{
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
} | null> {
  // 1) 先尝试数据源适配器（fundgz 取不到名时用传入的 otcName 作为搜索种子）
  try {
    const result = await dataSourceService.queryEtfMapping(otcCode, otcName)
    if (result) return result
  } catch { /* fallback to AI */ }

  // 2) 单只 AI 兜底
  try {
    const aiResult = await fetchEtfMappingViaAI(otcCode, otcName)
    if (aiResult) return aiResult
  } catch { /* ignore */ }

  console.info(`[ETF映射] 未找到场内ETF映射: ${otcCode}${otcName ? ' ' + otcName : ''}`)
  return null
}

/** 单只基金 AI 查询场内 ETF 映射 */
async function fetchEtfMappingViaAI(
  otcCode: string,
  otcName?: string,
): Promise<{ otcCode: string; otcName: string; exchangeCode: string; exchangeName: string } | null> {
  const ai = getDefaultAI()
  if (!ai) return null
  const prompt = `请查询场外基金 "${otcCode}"${otcName ? `（名称：${otcName}）` : ''} 对应的场内 ETF 信息。如果该基金有对应的场内可交易 ETF/LOF 品种，返回严格 JSON：
{
  "otcCode": "${otcCode}",
  "otcName": "场外基金全称",
  "exchangeCode": "对应场内 ETF 代码，如 512880",
  "exchangeName": "对应场内 ETF 名称"
}
如果找不到对应场内 ETF，返回 null。只返回 JSON，不要其他内容。`
  try {
    const response = await callAI(ai, [{ role: 'user', content: prompt }])
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0])
      if (result && result.exchangeCode) return result
    }
  } catch { /* ignore */ }
  return null
}

/**
 * 批量 AI 兜底：一次请求处理所有未命中的基金，性能远优于逐只调用 AI。
 */
async function fetchEtfMappingsViaAI(
  codes: string[],
  names: Record<string, string>,
): Promise<EtfMappingResult[]> {
  const ai = getDefaultAI()
  if (!ai || codes.length === 0) return []
  const items = codes.map((c) => ({ code: c, name: names[c] || '' }))
  const prompt = `你是中国基金市场专家。下面给出若干场外开放式基金（code=代码，name=名称）。
请为每一个能找到"对应场内可交易 ETF/LOF"品种的，返回一条映射记录；找不到的不要返回。
场内品种通常指跟踪同一指数的场内 ETF（如场外联接基金对应的标的 ETF）。
严格只返回一个 JSON 数组，不要任何其他文字：
[
  {"otcCode":"023765","otcName":"华夏中证5G通信主题ETF联接D","exchangeCode":"515050","exchangeName":"通信ETF华夏"}
]
待查询列表：
${JSON.stringify(items)}`
  try {
    const response = await callAI(ai, [{ role: 'user', content: prompt }])
    const arrMatch = response.match(/\[[\s\S]*\]/)
    if (!arrMatch) return []
    const arr = JSON.parse(arrMatch[0])
    if (!Array.isArray(arr)) return []
    const validCodes = new Set(codes)
    return arr
      .filter((r: any) => r && r.exchangeCode && validCodes.has(String(r.otcCode)))
      .map((r: any) => ({
        otcCode: String(r.otcCode),
        otcName: String(r.otcName || names[r.otcCode] || ''),
        exchangeCode: String(r.exchangeCode),
        exchangeName: String(r.exchangeName || ''),
      }))
  } catch {
    return []
  }
}

/**
 * 批量查询场外基金对应的场内 ETF 映射。
 *
 * 流程：
 * 1) 先用数据源适配器逐只查询（搜索接口为「按关键词单查」、无批量端点，故串行 + 间隔规避限流）；
 * 2) 收集数据源未命中的基金，发起【一次批量 AI 调用】作为兜底（性能更好）。
 *
 * @param codes   场外基金代码列表
 * @param opts.names  代码→名称 映射（fundgz 取不到名时作为搜索种子，也用于 AI 提示）
 * @param opts.onProgress 每处理完一只回调 (done, total)
 */
export async function fetchEtfMappings(
  codes: string[],
  opts: {
    onProgress?: (done: number, total: number) => void
    names?: Record<string, string>
  } = {},
): Promise<{ found: EtfMappingResult[]; missing: string[] }> {
  const names = opts.names || {}
  const found: EtfMappingResult[] = []
  const missing: string[] = []
  let done = 0
  // 1) 数据源逐只查询（不在此处逐只调 AI，AI 集中批量兜底）
  for (const code of codes) {
    try {
      const r = await dataSourceService.queryEtfMapping(code, names[code])
      if (r?.exchangeCode) found.push(r as EtfMappingResult)
      else missing.push(code)
    } catch {
      missing.push(code)
    }
    done++
    opts.onProgress?.(done, codes.length)
    if (done < codes.length) await sleep(200)
  }
  // 2) 批量 AI 兜底：一次请求处理所有未命中
  if (missing.length > 0) {
    const aiResults = await fetchEtfMappingsViaAI(missing, names)
    const have = new Set(found.map((f) => f.otcCode))
    for (const r of aiResults) {
      if (!have.has(r.otcCode)) {
        found.push(r)
        have.add(r.otcCode)
      }
    }
    return { found, missing: missing.filter((c) => !have.has(c)) }
  }
  return { found, missing }
}

// ─────────────────────────────────────────────────────────────────────────────
// ETF 映射「修正」推荐：用于修复已配置但 K 线取数失败的映射
// ─────────────────────────────────────────────────────────────────────────────

export interface EtfMappingRecommendation {
  otcCode: string
  otcName: string
  currentExchangeCode: string
  currentExchangeName: string
  recommendedExchangeCode: string
  recommendedExchangeName: string
  rule: 'same_company_same_index' | 'same_index_diff_company' | 'theme_related' | 'unknown'
  reason: string
  confidence: number // 0-1
  verified: boolean // 推荐的 exchangeCode 经 K 线端点验证可取到有效数据
  candidates?: { code: string; name: string; liquidity?: number }[]
}

const SIX_DIGIT = /^\d{6}$/
// 基金公司字号（用于 R1「同公司」判定）；越长越优先匹配
const COMPANY_PREFIXES = [
  '西藏东财', '天弘', '华夏', '易方达', '广发', '南方', '富国', '嘉实', '博时', '招商',
  '工银', '交银', '景顺', '汇添富', '鹏华', '国泰', '东财', '万家', '国联安', '银河',
  '银华', '长信', '前海开源', '申万菱信', '信达澳亚', '中欧', '兴全', '兴证全球', '华宝',
  '华安', '大成', '融通', '诺安', '建信', '中银', '国投瑞银', '泰康', '平安', '方正富邦',
  '永赢', '财通', '创金合信', '华泰柏瑞', '国寿安保', '西部利得', '德邦', '中庚', '安信',
  '诺德', '金鹰', '中海', '浙商', '北信瑞丰', '东兴', '华富', '长盛', '宝盈', '天治',
  '民生加银', '弘毅远方', '圆信永丰', '华润元大', '新疆前海', '红土创新', '泰信', '益民',
]
const NAME_SUFFIXES = [
  '发起式', '发起', 'ETF', '联接', '指数', '主题', '分级', 'LOF', '量化', '增强',
  '收益', '证券', '投资基金', '混合型', '股票型', '债券型', '基金',
  'A', 'B', 'C', 'D', 'E', 'I', 'O', 'F', 'H', 'R', 'Y',
]

/** 从场外基金名提取「主题/指数」关键词，用于腾讯搜索候选场内 ETF */
function extractThemeKeyword(name: string): string {
  let s = name || ''
  for (const p of COMPANY_PREFIXES) {
    if (s.startsWith(p)) { s = s.slice(p.length); break }
  }
  for (const suf of NAME_SUFFIXES) s = s.split(suf).join('')
  s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  return s.trim() || name
}

/**
 * 为「已配置但 K 线取数失败」的 ETF 映射推荐修正项。
 *
 * 流程：
 * 1) 腾讯 searchStocks 搜候选场内 ETF → 取 K 线成交量作为流动性代理 → 按流动性从高到低排序；
 * 2) 注入 R1-R4 规则让 LLM 终审，返回 recommendedExchangeCode/name/rule/reason/confidence；
 * 3) 用 fetchEtfKLine 验证推荐码可取到有效数据 → verified。
 *
 * 注意：直接走 AI 规则路径（不再查数据源，因为当前映射已疑似错误）。
 */
export async function recommendEtfMappingFix(
  mapping: { otcCode: string; otcName: string; exchangeCode: string; exchangeName: string },
): Promise<EtfMappingRecommendation | null> {
  const ai = getDefaultAI()
  if (!ai) return null

  // 1) 候选：腾讯搜索 + 流动性预排序（R2 代理）
  const keyword = extractThemeKeyword(mapping.otcName)
  let candidates: { code: string; name: string; liquidity?: number }[]
  try {
    const raw = await dataSourceService.searchStocks(keyword)
    const filtered = (raw || [])
      .map((r: { code?: string | number; name?: string }) => ({
        code: String(r.code || '').replace(/^(SZ|SH)/i, ''),
        name: String(r.name || ''),
      }))
      .filter(
        (r) =>
          SIX_DIGIT.test(r.code) &&
          /ETF|基金|LOF|指数|联接|篮|份额|主题/i.test(r.name),
      )
    const withLiquidity = await Promise.all(
      filtered.slice(0, 10).map(async (r) => {
        try {
          const k = await dataSourceService.fetchEtfKLine(r.code, '3m')
          const liquidity =
            k && k.length > 0
              ? k.reduce((sum: number, b: { volume?: number }) => sum + (b.volume || 0), 0) / k.length
              : 0
          return { code: r.code, name: r.name, liquidity }
        } catch {
          return { code: r.code, name: r.name, liquidity: 0 }
        }
      }),
    )
    candidates = withLiquidity.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
  } catch {
    candidates = []
  }

  // 2) 构造 prompt（注入规则 R1-R4 + 候选 + 现有错误映射）
  const prompt = `你是中国基金市场专家，负责为「场外开放式基金」修正其「对应场内 ETF」映射（映射错误会导致 K 线图无数据）。

场外基金：
- 代码：${mapping.otcCode}
- 名称：${mapping.otcName}
- 当前(疑似错误)映射的场内ETF：${mapping.exchangeCode} ${mapping.exchangeName}

候选场内ETF（已按近期流动性从高到低排序；code=代码 name=名称 liquidity=近期平均成交量，越大越代表规模/流动性高）：
${JSON.stringify(candidates)}

选择规则（严格按优先级）：
R1 同公司同指数(最强)：候选中「基金公司相同」(场外基金名与ETF名含同一公司字号，如"天弘")且「跟踪同一指数/主题」(主题关键词重叠最高) → 首选。
R2 同指数跨公司：若无同公司候选，选「跟踪同一指数」的场内ETF（主题关键词完全匹配），按 liquidity 排序取最靠前。
R3 仅主题相关(兜底)：无同指数候选时，选主题关键词重叠最多者，同样按 liquidity 优先。
R4 真实性：你选的 exchangeCode 必须对应一个真实可交易的场内ETF；若候选里没有合适的，可基于你的知识补充一个最合理的（但必须真实存在且能被行情接口取到数据）。

只输出严格 JSON（不要其他文字）：
{
  "recommendedExchangeCode": "6位代码",
  "recommendedExchangeName": "ETF名称",
  "rule": "same_company_same_index|same_index_diff_company|theme_related|unknown",
  "reason": "依据的规则与判断，中文，≤60字",
  "confidence": 0.0-1.0
}`

  // 3) 调用 LLM
  let parsed: {
    recommendedExchangeCode?: string
    recommendedExchangeName?: string
    rule?: EtfMappingRecommendation['rule']
    reason?: string
    confidence?: number
  } | null = null
  try {
    const response = await callAI(ai, [{ role: 'user', content: prompt }])
    const m = response.match(/\{[\s\S]*\}/)
    if (m) parsed = JSON.parse(m[0])
  } catch {
    parsed = null
  }
  if (!parsed || !parsed.recommendedExchangeCode) return null

  const recommendedExchangeCode = String(parsed.recommendedExchangeCode).replace(/^(SZ|SH)/i, '')
  const recommendedExchangeName = String(parsed.recommendedExchangeName || recommendedExchangeCode)

  // 4) 验证 K 线端点
  let verified: boolean
  try {
    const k = await dataSourceService.fetchEtfKLine(recommendedExchangeCode, '3m')
    verified = Array.isArray(k) && k.length > 0
  } catch {
    verified = false
  }

  return {
    otcCode: mapping.otcCode,
    otcName: mapping.otcName,
    currentExchangeCode: mapping.exchangeCode,
    currentExchangeName: mapping.exchangeName,
    recommendedExchangeCode,
    recommendedExchangeName,
    rule: parsed.rule || 'unknown',
    reason: String(parsed.reason || ''),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    verified,
    candidates,
  }
}

/**
 * 测试 AI API 联通性
 */
export async function testAIConnection(config: AIConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const start = Date.now()
    const response = await callAI(config, [
      { role: 'user', content: '回复"ok"表示连接正常，不要其他内容。' },
    ])
    const elapsed = Date.now() - start
    if (response.toLowerCase().includes('ok')) {
      return { ok: true, message: `连接成功 (${elapsed}ms)` }
    }
    return { ok: true, message: `已响应 (${elapsed}ms): ${response.slice(0, 30)}` }
  } catch (e) {
    return { ok: false, message: `连接失败: ${e instanceof Error ? e.message : '未知错误'}` }
  }
}

export { getDefaultAI, callAI }
