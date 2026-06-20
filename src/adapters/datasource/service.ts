import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { generateMockQuotes, generateMockKLine } from './base'
import { tushareAdapter } from './tushare'
import { eastMoneyAdapter } from './eastmoney'
import { akshareAdapter } from './akshare'
import { useSettingsStore } from '@/stores/settings'

class DataSourceService implements FundDataSource {
  name = 'datasource-service'

  /** 获取适配器列表（按优先级） */
  private getAdapters(): FundDataSource[] {
    const adapters: FundDataSource[] = []
    const primary = useSettingsStore.getState().settings.dataSource.primarySource
    const akshareURL = useSettingsStore.getState().settings.dataSource.akshareURL

    // 1. AKShare（本地运行 AKTools，最可靠）
    if (primary === 'akshare' || akshareURL) {
      adapters.push(akshareAdapter)
    }

    // 2. Tushare
    if (primary === 'tushare' && tushareAdapter.isConfigured()) {
      adapters.push(tushareAdapter)
    }

    // 3. 东方财富 JSONP（免费，无需配置）
    adapters.push(eastMoneyAdapter)

    return adapters
  }

  isConfigured(): boolean {
    return true
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    for (const adapter of this.getAdapters()) {
      try {
        const result = await adapter.fetchFundInfo(code)
        if (result && result.name !== code) return result
      } catch { /* try next */ }
    }
    return { name: code, type: 'stock' }
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    for (const adapter of this.getAdapters()) {
      try {
        const data = await adapter.fetchQuotes(codes)
        if (data.length > 0 && data.some((q) => q.nav !== 1 || q.dailyChange !== 0)) {
          return data
        }
      } catch { /* try next */ }
    }
    return generateMockQuotes(codes)
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    for (const adapter of this.getAdapters()) {
      try {
        const data = await adapter.fetchKLine(code, period)
        if (data.length > 0) return data
      } catch { /* try next */ }
    }
    return generateMockKLine(code, period)
  }
}

export const dataSourceService = new DataSourceService()
