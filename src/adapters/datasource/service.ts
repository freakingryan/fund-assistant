import type { DatasourceHealth, EtfMapping, FundPortfolio, FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { stockApiAdapter } from './stock-api'
import { eastMoneyAdapter } from './eastmoney'
import { fetchFundGzJsonp } from './jsonp-utils'

class DataSourceService implements FundDataSource {
  name = 'datasource-service'

  /** 获取适配器列表（按优先级） */
  private getAdapters(): FundDataSource[] {
    const adapters: FundDataSource[] = []

    // 1. stock-api（纯前端，零后端依赖，腾讯/新浪/东方财富自动兜底）
    adapters.push(stockApiAdapter)

    // 2. 东方财富 JSONP（免费，无需配置）
    adapters.push(eastMoneyAdapter)

    return adapters
  }

  isConfigured(): boolean {
    return true
  }

  /**
   * 依次尝试适配器链中的每个适配器，返回第一个通过校验的结果。
   * 任一适配器抛错则自动跳过，尝试下一个（与原有的「循环 + try/catch」语义一致）。
   * @param makeCall 从适配器取出一个已绑定参数的调用；若适配器不支持该方法则返回 null 跳过
   * @param accept   判断结果是否可用的断言，默认「非空即接受」
   */
  private async tryFirst<R>(
    makeCall: (a: FundDataSource) => (() => Promise<R>) | null,
    accept: (r: R) => boolean = (r) => r !== null && r !== undefined
  ): Promise<R | null> {
    for (const a of this.getAdapters()) {
      const call = makeCall(a)
      if (!call) continue
      try {
        const r = await call()
        if (accept(r)) return r
      } catch { /* try next adapter */ }
    }
    return null
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    const result = await this.tryFirst(
      (a) => () => a.fetchFundInfo(code),
      (r) => !!r && r.name !== code
    )
    return result ?? { name: code, type: 'stock' }
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    return (await this.tryFirst(
      (a) => () => a.fetchQuotes(codes),
      (data) => data.length > 0 && data.some((q) => q.nav !== 1 || q.dailyChange !== 0)
    )) ?? []
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return (await this.tryFirst(
      (a) => {
        if (typeof a.fetchKLine !== 'function') return null
        return () => a.fetchKLine(code, period)
      },
      (data) => data.length > 0
    )) ?? []
  }

  /**
   * 获取场内 ETF 真实 K 线（必须由支持此接口的适配器提供）
   * 从第一个支持 fetchEtfKLine 的适配器获取，若均不支持则返回空数组
   */
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return (await this.tryFirst(
      (a) => {
        if (typeof a.fetchEtfKLine !== 'function') return null
        return () => a.fetchEtfKLine(code, period)
      },
      (data) => data.length > 0
    )) ?? []
  }

  /**
   * 获取个股真实 K 线（含 OHLC 和成交量）
   * 从第一个支持 fetchStockKLine 的适配器获取
   */
  async fetchStockKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return (await this.tryFirst(
      (a) => {
        if (typeof a.fetchStockKLine !== 'function') return null
        return () => a.fetchStockKLine(code, period)
      },
      (data) => data.length > 0
    )) ?? []
  }

  /**
   * 获取个股实时行情（现价/涨跌幅）
   * 从第一个支持 fetchStockQuote 的适配器获取
   */
  async fetchStockQuote(code: string): Promise<FundQuote | null> {
    return this.tryFirst((a) => {
      if (typeof a.fetchStockQuote !== 'function') return null
      return () => a.fetchStockQuote(code)
    })
  }

  /**
   * 获取基金持仓明细（前十大重仓股）
   */
  async fetchFundPortfolio(fundCode: string): Promise<FundPortfolio | null> {
    return this.tryFirst((a) => {
      if (typeof a.fetchFundPortfolio !== 'function') return null
      return () => a.fetchFundPortfolio(fundCode)
    })
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   */
  async queryEtfMapping(otcCode: string): Promise<EtfMapping | null> {
    return this.tryFirst((a) => {
      if (typeof a.queryEtfMapping !== 'function') return null
      return () => a.queryEtfMapping(otcCode)
    })
  }

  /**
   * 搜索股票/基金
   * 通过 stock-api 的 searchStocks 实现关键词搜索
   */
  async searchStocks(key: string): Promise<{ code: string; name: string }[]> {
    return (await this.tryFirst(
      (a) => {
        if (typeof a.searchStocks !== 'function') return null
        return () => a.searchStocks(key)
      },
      (data) => data.length > 0
    )) ?? []
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
        if (info && info.name !== key && info.name !== '---') {
          results.push({ code: key, name: info.name })
          seen.add(key)
        }
      } catch { /* ignore */ }
      // 如果适配器链没有返回有效名称，尝试直接通过 fundgz 查询
      if (!seen.has(key)) {
        try {
          const fundData = await fetchFundGzJsonp(key)
          if (fundData?.name && fundData.name !== key) {
            results.push({ code: key, name: fundData.name })
            seen.add(key)
          }
        } catch { /* ignore */ }
      }
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
  async checkHealth(): Promise<DatasourceHealth> {
    const result = await this.tryFirst((a) => {
      if (typeof a.checkHealth !== 'function') return null
      return () => a.checkHealth()
    })
    if (result) return result
    return {
      stockApi: { ok: false, latency: 0, error: '无适配器支持' },
      fundgz: { ok: false, latency: 0, error: '无适配器支持' },
      pingzhongdata: { ok: false, latency: 0, error: '无适配器支持' },
    }
  }
}

export const dataSourceService = new DataSourceService()
