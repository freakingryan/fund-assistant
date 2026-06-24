import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { useSettingsStore } from '@/stores/settings'

/**
 * Tushare 通用响应结构
 */
interface TushareResponse<T = any> {
  code: number
  msg?: string
  data?: {
    fields: string[]
    items: T[]
  }
  items?: T[]
}

/**
 * 按 fields 映射后的行对象
 */
type RowObject = Record<string, string | number | undefined>

/**
 * Tushare 数据源适配器
 *
 * API 文档：https://tushare.pro/document/2
 */
export class TushareAdapter implements FundDataSource {
  name = 'tushare'

  private get token(): string {
    return useSettingsStore.getState().settings.dataSource.tushareToken
  }

  private async call<T = RowObject>(
    apiName: string,
    params: Record<string, unknown> = {},
    fields: string[] = [],
  ): Promise<TushareResponse<T>> {
    const token = this.token
    if (!token) throw new Error('Tushare Token 未配置')

    const body: Record<string, any> = { api_name: apiName, token, params }
    if (fields.length > 0) body.fields = fields.join(',')

    const res = await fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`Tushare HTTP ${res.status}`)

    const json = await res.json()
    if (json.code !== 0) throw new Error(`Tushare error: ${json.msg}`)

    // I1 fix: 按 fields 映射为对象数组
    if (json.data && fields.length > 0 && Array.isArray(json.data.items)) {
      return {
        ...json,
        items: json.data.items.map((item: any[]) => {
          const obj: RowObject = {}
          fields.forEach((f, i) => { obj[f] = item[i] })
          return obj as T
        }),
      }
    }

    return json
  }

  isConfigured(): boolean {
    return !!this.token
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    const data = await this.call('fund_basic', { ts_code: code }, [
      'ts_code', 'name', 'fund_type',
    ])
    const item = data?.items?.[0]
    return {
      name: (item as any)?.name || code,
      type: (item as any)?.fund_type || '股票型',
    }
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    const data = await this.call('fund_nav', {
      ts_code: codes.join(','),
      end_date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    }, ['ts_code', 'nav_date', 'unit_nav', 'accum_nav', 'adj_nav'])

    if (!data?.items) return []

    const quoteMap = new Map<string, any>()
    for (const item of data.items as any[]) {
      if (!quoteMap.has(item.ts_code)) {
        quoteMap.set(item.ts_code, item)
      }
    }

    const changesMap = new Map<string, number>()
    try {
      const dailyData = await this.call('fund_daily', {
        ts_code: codes.join(','),
        trade_date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      }, ['ts_code', 'pct_chg'])
      if (dailyData?.items) {
        for (const item of dailyData.items as any[]) {
          changesMap.set(item.ts_code, item.pct_chg || 0)
        }
      }
    } catch { /* daily data optional */ }

    return codes.map((code) => {
      const item = quoteMap.get(code)
      return {
        code,
        name: `基金 ${code}`,
        nav: item?.unit_nav || item?.adj_nav || 1,
        accNav: item?.accum_nav || item?.unit_nav || 1,
        dailyChange: changesMap.get(code) || 0,
        navDate: item?.nav_date || '',
      }
    })
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    const days = period === '1m' ? 22 : period === '6m' ? 132 : period === '1y' ? 250 : 66
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - (days + 10) * 86400000)

    const data = await this.call('fund_nav', {
      ts_code: code,
      start_date: startDate.toISOString().slice(0, 10).replace(/-/g, ''),
      end_date: endDate.toISOString().slice(0, 10).replace(/-/g, ''),
    }, ['nav_date', 'unit_nav', 'accum_nav'])

    if (!data?.items) return []

    // I2 fix: 基金净值无 OHLC，用前一日净值作为 open
    const items = (data.items as any[]).reverse()
    return items.map((item, idx) => ({
      date: item.nav_date,
      open: items[idx + 1]?.unit_nav ?? item.unit_nav,  // 前一日净值 ≈ "开盘"
      close: item.unit_nav,
      high: item.unit_nav,
      low: item.unit_nav,
      volume: 0,
    }))
  }
}

export const tushareAdapter = new TushareAdapter()
