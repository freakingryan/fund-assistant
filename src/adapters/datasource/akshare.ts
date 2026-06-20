import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { useSettingsStore } from '@/stores/settings'
import { generateMockQuotes, generateMockKLine } from './base'

/**
 * AKShare 数据源适配器（通过 AKTools HTTP API）
 *
 * 需要本地运行：python -m aktools
 * 文档：https://aktools.akfamily.xyz/
 *
 * API 格式：GET http://{host}:{port}/api/public/{api_name}?参数
 * 返回：JSON 数组
 */
export class AKShareAdapter implements FundDataSource {
  name = 'akshare'

  private get baseURL(): string {
    const cfg = useSettingsStore.getState().settings.dataSource.akshareURL
    return cfg || 'http://127.0.0.1:8080'
  }

  private async call<T = any[]>(apiName: string, params: Record<string, string> = {}): Promise<T[]> {
    const url = new URL(`${this.baseURL}/api/public/${apiName}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), { mode: 'cors' })
    if (!res.ok) throw new Error(`AKShare HTTP ${res.status}: ${await res.text().catch(() => '')}`)

    const data = await res.json()
    if (!Array.isArray(data)) throw new Error('AKShare 返回格式异常')
    return data as T[]
  }

  isConfigured(): boolean {
    return true
  }

  /**
   * fund_name_em 返回所有基金基本信息
   * 字段示例：基金代码, 基金简称, 基金类型, 基金管理人, 基金规模
   */
  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    try {
      const list = await this.call<Record<string, any>>('fund_name_em')
      const fund = list.find((item: any) => String(item['基金代码'] || item['ts_code'] || '') === code)
      if (fund) {
        const name = fund['基金简称'] || fund['基金名称'] || code
        const type = fund['基金类型'] || fund['fund_type'] || '其他'
        return { name, type: this.classifyType(name, type) }
      }
    } catch { /* fallback */ }
    return { name: code, type: '其他' }
  }

  /**
   * fund_open_fund_daily_em — 开放式基金实时净值
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    try {
      const list = await this.call<Record<string, any>>('fund_open_fund_daily_em')
      const results: FundQuote[] = []
      for (const code of codes) {
        const item = list.find((i: any) => String(i['基金代码'] || '') === code)
        if (item) {
          results.push({
            code,
            name: item['基金简称'] || code,
            nav: Number(item['单位净值'] || item['最新净值'] || 1),
            accNav: Number(item['累计净值'] || item['单位净值'] || 1),
            dailyChange: Number(item['日增长率']?.replace('%', '') || item['pct_change'] || 0),
            navDate: item['净值日期'] || item['trade_date'] || '',
          })
        } else {
          results.push({ code, name: `基金 ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' })
        }
      }
      return results
    } catch { /* fallback */ }
    return generateMockQuotes(codes)
  }

  /**
   * fund_open_fund_info_em — 历史净值走势
   */
  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    try {
      const data = await this.call<Record<string, any>>('fund_open_fund_info_em', {
        symbol: code,
        indicator: 'unit_nav',
      })
      if (data.length > 0) {
        return data.map((item: any) => ({
          date: item['净值日期'] || item['date'] || '',
          open: Number(item['单位净值'] || item['nav'] || 0),
          close: Number(item['单位净值'] || item['nav'] || 0),
          high: Number(item['单位净值'] || item['nav'] || 0),
          low: Number(item['单位净值'] || item['nav'] || 0),
          volume: 0,
        })).reverse()
      }
    } catch { /* fallback */ }
    return generateMockKLine(code, period)
  }

  private classifyType(name: string, type: string): string {
    if (type && type !== '其他') {
      if (type.includes('货币')) return '货币型'
      if (type.includes('债券')) return '债券型'
      if (type.includes('指数')) return '指数型'
      if (type.includes('QDII')) return 'QDII'
      if (type.includes('混合')) return '混合型'
      return type
    }
    const n = name
    if (n.includes('货币')) return '货币型'
    if (n.includes('债券') || n.includes('债')) return '债券型'
    if (n.includes('指数') || n.includes('ETF') || n.includes('联接')) return '指数型'
    if (n.includes('QDII')) return 'QDII'
    if (n.includes('混合') || n.includes('灵活')) return '混合型'
    return '股票型'
  }
}

export const akshareAdapter = new AKShareAdapter()
