import type { FundQuote, KLineData } from '@/types'

export interface FundDataSource {
  name: string
  fetchFundInfo(code: string): Promise<{ name: string; type: string }>
  fetchQuotes(codes: string[]): Promise<FundQuote[]>
  fetchKLine(code: string, period?: string): Promise<KLineData[]>

  /**
   * 获取场内 ETF 真实 K 线（含 OHLC 和成交量）
   * @param code ETF 代码
   * @param period 周期：1m, 3m, 6m, 1y
   */
  fetchEtfKLine?(code: string, period?: string): Promise<KLineData[]>

  /** 数据源是否已配置 */
  isConfigured(): boolean
}

/** 简单哈希：将字符串转为数字种子 */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** 种子随机数生成器（Mulberry32） */
function seededRandom(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成模拟 K 线数据（基于 fund code + period 的确定性种子）
 * 同一基金同周期每次调用数据一致
 */
export function generateMockKLine(code: string, _period = '3m', basePrice = 1): KLineData[] {
  const seed = hashStr(`${code}_${_period}`)
  const rand = seededRandom(seed)
  const now = Date.now()
  const days = _period === '1m' ? 22 : _period === '6m' ? 132 : _period === '1y' ? 250 : 66
  const data: KLineData[] = []
  let price = basePrice * (0.8 + rand() * 0.4)
  const trend = (rand() - 0.3) * 0.002

  for (let i = days; i >= 0; i--) {
    const open = price
    const change = (rand() - 0.5) * price * 0.015 + trend * price
    const close = price + change
    const high = Math.max(open, close) * (1 + rand() * 0.01)
    const low = Math.min(open, close) * (1 - rand() * 0.01)
    const volume = Math.floor(rand() * 100000) + 10000

    data.push({
      date: new Date(now - i * 86400000).toISOString().slice(0, 10),
      open: Math.round(open * 10000) / 10000,
      close: Math.round(close * 10000) / 10000,
      high: Math.round(high * 10000) / 10000,
      low: Math.round(low * 10000) / 10000,
      volume,
    })
    price = close
  }
  return data
}

/**
 * 生成模拟行情数据（基于 fund code 的确定性种子）
 * 同一基金每次调用数据一致
 */
export function generateMockQuotes(codes: string[]): FundQuote[] {
  return codes.map((code) => {
    const seed = hashStr(code)
    const rand = seededRandom(seed)
    return {
      code,
      name: `基金 ${code}`,
      nav: Math.round((0.5 + rand() * 2.5) * 10000) / 10000,
      accNav: Math.round((1 + rand() * 3) * 10000) / 10000,
      dailyChange: Math.round((rand() * 6 - 2) * 100) / 100,
      navDate: new Date().toISOString().slice(0, 10),
    }
  })
}
