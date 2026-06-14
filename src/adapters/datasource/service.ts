import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { generateMockQuotes, generateMockKLine } from './base'
import { tushareAdapter } from './tushare'
import { useSettingsStore } from '@/stores/settings'

class DataSourceService implements FundDataSource {
  name = 'datasource-service'

  private getAdapter(): FundDataSource | null {
    const primary = useSettingsStore.getState().settings.dataSource.primarySource
    switch (primary) {
      case 'tushare':
        if (tushareAdapter.isConfigured()) return tushareAdapter
        break
      // westock / neodata 将在 Phase 4+ 接入
    }
    return null
  }

  isConfigured(): boolean {
    return this.getAdapter() !== null
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    const adapter = this.getAdapter()
    if (adapter) return adapter.fetchFundInfo(code)
    return { name: code, type: 'stock' }
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    const adapter = this.getAdapter()
    if (adapter) {
      try {
        return await adapter.fetchQuotes(codes)
      } catch (e) {
        console.warn('数据源调用失败，使用模拟数据', e)
      }
    }
    return generateMockQuotes(codes)
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    const adapter = this.getAdapter()
    if (adapter) {
      try {
        const data = await adapter.fetchKLine(code, period)
        if (data.length > 0) return data
      } catch (e) {
        console.warn('K线数据获取失败，使用模拟数据', e)
      }
    }
    return generateMockKLine(code, period)
  }
}

export const dataSourceService = new DataSourceService()
