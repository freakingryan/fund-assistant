import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { stockApiAdapter } from './stock-api'
import { tushareAdapter } from './tushare'
import { eastMoneyAdapter } from './eastmoney'
import { useSettingsStore } from '@/stores/settings'

class DataSourceService implements FundDataSource {
  name = 'datasource-service'

  /** 获取适配器列表（按优先级） */
  private getAdapters(): FundDataSource[] {
    const adapters: FundDataSource[] = []
    const primary = useSettingsStore.getState().settings.dataSource.primarySource

    // 1. stock-api（纯前端，零后端依赖，腾讯/新浪/东方财富自动兜底）
    adapters.push(stockApiAdapter)

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
    return []
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    for (const adapter of this.getAdapters()) {
      try {
        const data = await adapter.fetchKLine(code, period)
        if (data.length > 0) return data
      } catch { /* try next */ }
    }
    return []
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

  /**
   * 搜索股票/基金
   * 通过 stock-api 的 searchStocks 实现关键词搜索
   */
  async searchStocks(key: string): Promise<{ code: string; name: string }[]> {
    for (const adapter of this.getAdapters()) {
      if (typeof (adapter as any).searchStocks === 'function') {
        try {
          const data = await (adapter as any).searchStocks(key)
          if (data.length > 0) return data
        } catch { /* try next */ }
      }
    }
    return []
  }

  /**
   * 搜索所有基金/ETF（场外 + 场内）
   * 查询时自动识别：
   * - 纯数字代码 → 尝试 fundgz 直接获取场外基金信息
   * - 关键词 → 通过 stock-api 搜索场内基金/ETF
   */
  async searchFunds(key: string): Promise<{ code: string; name: string }[]> {
    const results: { code: string; name: string }[] = []
    const seen = new Set<string>()

    // 1) 如果是纯数字（场外基金代码），直接查询基金信息
    if (/^\d{6}$/.test(key)) {
      try {
        const info = await this.fetchFundInfo(key)
        if (info && info.name !== key) {
          results.push({ code: key, name: info.name })
          seen.add(key)
        }
      } catch { /* ignore */ }
    }

    // 2) 通过 stock-api 搜索场内基金/ETF
    try {
      const stockResults = await this.searchStocks(key)
      for (const r of stockResults) {
        const cleanCode = r.code.replace(/^(SZ|SH)/, '')
        if (!seen.has(cleanCode)) {
          results.push({ code: cleanCode, name: r.name })
          seen.add(cleanCode)
        }
      }
    } catch { /* ignore */ }

    return results
  }

  /**
   * 检查所有适配器的数据源健康状态
   */
  async checkHealth(): Promise<{
    stockApi: { ok: boolean; latency: number; error?: string }
    fundgz: { ok: boolean; latency: number; error?: string }
    pingzhongdata: { ok: boolean; latency: number; error?: string }
  }> {
    const adapters = this.getAdapters()
    for (const adapter of adapters) {
      if (typeof (adapter as any).checkHealth === 'function') {
        try {
          return await (adapter as any).checkHealth()
        } catch { /* try next */ }
      }
    }
    return {
      stockApi: { ok: false, latency: 0, error: '无适配器支持' },
      fundgz: { ok: false, latency: 0, error: '无适配器支持' },
      pingzhongdata: { ok: false, latency: 0, error: '无适配器支持' },
    }
  }
}

export const dataSourceService = new DataSourceService()
