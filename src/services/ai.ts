import { useSettingsStore } from '@/stores/settings'
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
    google: baseURL || `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${apiKey}`,
    custom: baseURL || 'https://api.openai.com/v1/chat/completions',
  }

  const defaultModels: Record<string, string> = {
    deepseek: model || 'deepseek-chat',
    openai: model || 'gpt-4o',
    google: 'gemini-2.0-flash',
    custom: model || 'gpt-4o',
  }

  if (provider === 'google') {
    // Google AI Studio uses a different API format
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

    const res = await fetch(endpoints.google, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  const response = await callAI(ai, messages as any)

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

export { getDefaultAI }
