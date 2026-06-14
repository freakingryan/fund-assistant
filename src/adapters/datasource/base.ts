import type { FundQuote, KLineData } from '@/types'

export interface FundDataSource {
  name: string
  /**
   * 获取基金基本信息（名称、类型等）
   */
  fetchFundInfo(code: string): Promise<{ name: string; type: string }>

  /**
   * 批量获取基金最新净值/行情
   */
  fetchQuotes(codes: string[]): Promise<FundQuote[]>

  /**
   * 获取基金历史 K 线数据
   * @param period 周期：1m, 3m, 6m, 1y
   */
  fetchKLine(code: string, period?: string): Promise<KLineData[]>

  /** 数据源是否已配置 */
  isConfigured(): boolean
}

/**
 * 生成模拟 K 线数据（当数据源不可用时）
 */
export function generateMockKLine(code: string, _period = '3m', basePrice = 1): KLineData[] {
  const now = Date.now()
  const days = _period === '1m' ? 22 : _period === '6m' ? 132 : _period === '1y' ? 250 : 66
  const data: KLineData[] = []
  let price = basePrice * (0.8 + Math.random() * 0.4)
  const trend = (Math.random() - 0.3) * 0.002 // slight upward bias

  for (let i = days; i >= 0; i--) {
    const open = price
    const change = (Math.random() - 0.5) * price * 0.015 + trend * price
    const close = price + change
    const high = Math.max(open, close) * (1 + Math.random() * 0.01)
    const low = Math.min(open, close) * (1 - Math.random() * 0.01)
    const volume = Math.floor(Math.random() * 100000) + 10000

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
 * 生成模拟行情数据
 */
export function generateMockQuotes(codes: string[]): FundQuote[] {
  return codes.map((code) => ({
    code,
    name: `基金 ${code}`,
    nav: Math.round((0.5 + Math.random() * 2.5) * 10000) / 10000,
    accNav: Math.round((1 + Math.random() * 3) * 10000) / 10000,
    dailyChange: Math.round((Math.random() * 6 - 2) * 100) / 100,
    navDate: new Date().toISOString().slice(0, 10),
  }))
}
