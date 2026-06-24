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

  /**
   * 获取场内 ETF 真实 K 线（必须由支持此接口的适配器提供）
   * 从第一个支持 fetchEtfKLine 的适配器获取，若均不支持则返回空数组
   */
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    for (const adapter of this.getAdapters()) {
      if (typeof adapter.fetchEtfKLine === 'function') {
        try {
          const data = await adapter.fetchEtfKLine(code, period)
          if (data.length > 0) return data
        } catch { /* try next */ }
      }
    }
    return []
  }

  /**
   * 获取基金持仓明细（前十大重仓股）
   */
  async fetchFundPortfolio(fundCode: string): Promise<{
    date: string
    holdings: { code: string; name: string; ratio: number; value: number }[]
  } | null> {
    for (const adapter of this.getAdapters()) {
      if (typeof (adapter as any).fetchFundPortfolio === 'function') {
        try {
          const result = await (adapter as any).fetchFundPortfolio(fundCode)
          if (result) return result
        } catch { /* try next */ }
      }
    }
    return null
  }

  /**
   * 获取开放基金排行
   */
  async fetchFundRank(symbol = '全部', topN = 50): Promise<any[]> {
    for (const adapter of this.getAdapters()) {
      if (typeof (adapter as any).fetchFundRank === 'function') {
        try {
          const data = await (adapter as any).fetchFundRank(symbol, topN)
          if (data.length > 0) return data
        } catch { /* try next */ }
      }
    }
    return []
  }
  /**
   * 是否配置了 AKShare（AKTools 服务）
   */
  isAkshareConfigured(): boolean {
    const cfg = useSettingsStore.getState().settings.dataSource
    return cfg.primarySource === 'akshare' || !!cfg.akshareURL
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   */
  async queryEtfMapping(otcCode: string): Promise<{
    otcCode: string
    otcName: string
    exchangeCode: string
    exchangeName: string
  } | null> {
    for (const adapter of this.getAdapters()) {
      if (typeof (adapter as any).queryEtfMapping === 'function') {
        try {
          const result = await (adapter as any).queryEtfMapping(otcCode)
          if (result) return result
        } catch { /* try next */ }
      }
    }
    return null
  }
}

export const dataSourceService = new DataSourceService()
