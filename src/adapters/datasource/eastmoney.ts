import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { fetchFundGzJsonp } from './jsonp-utils'

/**
 * 东方财富基金数据源（免费、无 Token、JSONP 规避 CORS）
 */
export class EastMoneyAdapter implements FundDataSource {
  name = 'eastmoney'

  isConfigured(): boolean {
    return true
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    try {
      const data = await fetchFundGzJsonp(code)
      if (data?.name) {
        return { name: data.name, type: this.classifyType(data.name) }
      }
    } catch { /* fallback */ }
    return { name: code, type: '其他' }
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    const results: FundQuote[] = []
    for (const code of codes) {
      try {
        const data = await fetchFundGzJsonp(code)
        if (data) {
          const gsz = Number(data.gsz) || 0
          const dwjz = Number(data.dwjz) || 0
          results.push({
            code: data.fundcode,
            name: data.name,
            nav: gsz > 0 ? gsz : dwjz, // 优先估算净值，其次昨日净值
            accNav: Number(data.dwjz) || 1,
            dailyChange: Number(data.gszzl) || 0,
            navDate: String(data.gztime || data.jzrq || '').slice(0, 10),
          })
          continue
        }
      } catch { /* try next */ }
    }
    if (results.length === 0) return []
    for (const code of codes) {
      if (!results.find((r) => r.code === code)) {
        results.push({ code, name: `基金 ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' })
      }
    }
    return results
  }

  async fetchKLine(code: string, _period = '3m'): Promise<KLineData[]> {
    // 东财 JSONP 接口暂未实现，返回空数组
    return []
  }

  private classifyType(name: string): string {
    const n = name
    if (n.includes('货币')) return '货币型'
    if (n.includes('债券') || n.includes('债')) return '债券型'
    if (n.includes('指数') || n.includes('ETF') || n.includes('联接')) return '指数型'
    if (n.includes('QDII')) return 'QDII'
    if (n.includes('混合') || n.includes('灵活')) return '混合型'
    return '股票型'
  }
}

export const eastMoneyAdapter = new EastMoneyAdapter()
