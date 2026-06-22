import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { akshareAdapter } from '@/adapters/datasource/akshare'
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
    google: baseURL || `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent`,
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
 */
export async function extractFundInfoFromImage(imageDataUrl: string): Promise<{
  holdings: Array<{
    code: string
    name: string
    costNAV: number
    shares: number
  }>
  raw: string
}> {
  const ai = getDefaultAI()
  if (!ai) throw new Error('请先在设置页配置 AI API Key')

  const prompt = `你是一个基金持仓数据提取助手。请从这张持仓截图中提取所有基金信息。
对每只基金返回：基金代码、基金名称、持仓成本净值、持有份额。
请严格按以下 JSON 格式返回，不要包含其他内容：
{
  "holdings": [
    {
      "code": "基金代码",
      "name": "基金名称", 
      "costNAV": 持仓成本净值(数字),
      "shares": 持有份额(数字)
    }
  ]
}
如果看不清某些数据，costNAV 或 shares 可以填 0，但 code 和 name 必须尽量识别。`

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
 * 优先级：AKShare 数据匹配 → AI 查询
 */
export async function fetchEtfMapping(otcCode: string): Promise<{
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
} | null> {
  // 1) 先尝试 AKShare 数据源（fund_name_em + fund_etf_spot_em 匹配）
  try {
    const result = await akshareAdapter.queryEtfMapping(otcCode)
    if (result) return result
  } catch { /* fallback to AI */ }

  // 2) AI 查询（可能受 CORS 限制）
  const ai = getDefaultAI()
  if (!ai) return null

  const prompt = `请查询场外基金 "${otcCode}" 对应的场内 ETF 信息。如果该基金有对应的场内 ETF 可交易品种，返回严格 JSON：
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
  } catch { /* fallback */ }
  return null
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

export { getDefaultAI }
