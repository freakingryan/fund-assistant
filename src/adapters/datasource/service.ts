import type { DatasourceHealth, EtfMapping, FundPortfolio, FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { stockSdkAdapter } from './stockSdkAdapter'
import { eastMoneyAdapter } from './eastmoney'
import { fetchFundGzJsonp } from './jsonp-utils'
import { dedupRequest } from './requestDedup'
import { callWithBreaker } from './circuitBreaker'
import { withThrottle } from './rateLimit'

/**
 * 端点类别键 —— 熔断/节流都按此维度共享状态。
 * 同一上游（如腾讯 K 线）下所有 code 共用一个熔断/节流通道：
 * 一个端点挂了 → 全体停手；不同上游互不影响。
 */
const EP = {
  ETF_KLINE: 'tencent-kline',
  STOCK_KLINE: 'tencent-kline',
  NAV_KLINE: 'tencent-kline',
  FUND_QUOTE: 'tencent-fund-quote',
  STOCK_QUOTE: 'tencent-stock-quote',
  FUND_INFO: 'eastmoney-fund-info',
  PORTFOLIO: 'eastmoney-fund-portfolio',
  ETF_MAPPING: 'eastmoney-etf-mapping',
  SEARCH: 'tencent-stock-search',
} as const

/** 各端点类别的最小请求间隔（毫秒）：把批量扫描摊平成匀速脉冲 */
const THROTTLE_INTERVAL: Record<string, number> = {
  'tencent-kline': 150,
  'tencent-fund-quote': 80,
  'tencent-stock-quote': 80,
  'eastmoney-fund-info': 100,
  'eastmoney-fund-portfolio': 120,
  'eastmoney-etf-mapping': 120,
  'tencent-stock-search': 100,
}

/**
 * 组合三层调用层防护：
 *   dedupRequest  → 同一时刻、同一 key 只发一次（防并发重复）
 *   withThrottle  → 同一上游相邻请求间隔（防瞬时猛捶）
 *   callWithBreaker → 上游连续失败短路（防刷屏 / 被封）
 *
 * @param dedupKey  细粒度 key（含 code），用于并发去重
 * @param endpointKey 粗粒度端点类别键，用于熔断/节流
 * @param makeCall  真实取数逻辑（通常包一层 tryFirst 走适配器链）
 * @param fallback  上游失败/熔断时的降级返回值（数组→[]，对象→null 等），绝不抛给调用方
 * @param opts.treatEmptyAsFailure 查无结果是否计为失败（K 线/报价=true；查详情=null 合法=false）
 * @param opts.accept 判断结果是否可用的断言（用于区分「查无」与「成功」）
 */
function guarded<T>(
  dedupKey: string,
  endpointKey: string,
  makeCall: () => Promise<T | null>,
  fallback: T,
  opts?: { treatEmptyAsFailure?: boolean; accept?: (r: T) => boolean },
): Promise<T> {
  const interval = THROTTLE_INTERVAL[endpointKey] ?? 100
  return dedupRequest(dedupKey, () =>
    withThrottle(endpointKey, interval, () =>
      callWithBreaker(endpointKey, async () => {
        const r = await makeCall()
        const invalid = r == null || (opts?.accept ? !opts.accept(r) : false)
        // 查无结果且应计为失败 → 抛错让 breaker 计数；否则降级为 fallback（不熔断）
        if (invalid && opts?.treatEmptyAsFailure !== false) {
          throw new Error(`[${endpointKey}] 无可用数据`)
        }
        return invalid ? fallback : r
      }).catch(() => fallback),
    ),
  )
}

class DataSourceService implements FundDataSource {
  name = 'datasource-service'

  /** 获取适配器列表（按优先级） */
  private getAdapters(): FundDataSource[] {
    const adapters: FundDataSource[] = []

    // 1. stock-sdk（迁移目标，单一真相来源；P1 起真实 K 线走 SDK 原生实现，
    //    其余方法暂委托 stock-api，待 P2~P4 逐步替换为 SDK 原生实现）
    adapters.push(stockSdkAdapter)

    // 2. 东方财富 JSONP（免费，无需配置；作为 fundgz 类接口的兜底）
    adapters.push(eastMoneyAdapter)

    return adapters
  }

  isConfigured(): boolean {
    return true
  }

  /**
   * 依次尝试适配器链中的每个适配器，返回第一个通过校验的结果。
   * - 任一适配器抛错则跳过下一个（catch 不阻断）；
   * - **所有适配器都抛错**（上游不可用）时，统一抛错，让外层 circuit-breaker 计入失败并熔断；
   * - 所有适配器都成功但无可用数据（查无结果）时返回 null（由 guarded 决定是否计为失败）。
   */
  private async tryFirst<R>(
    makeCall: (a: FundDataSource) => Promise<R> | null,
    accept: (r: R) => boolean = (r) => r !== null && r !== undefined,
  ): Promise<R | null> {
    let adapterThrew = false
    for (const a of this.getAdapters()) {
      try {
        const r = await makeCall(a)
        if (r != null && accept(r)) return r
      } catch {
        adapterThrew = true
      }
    }
    if (adapterThrew) {
      throw new Error('[tryFirst] 所有适配器均抛错（上游不可用）')
    }
    return null
  }

  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    return guarded(
      'fundinfo:' + code,
      EP.FUND_INFO,
      () =>
        this.tryFirst(
          (a) => a.fetchFundInfo(code),
          (r) => !!r && r.name !== code,
        ),
      { name: code, type: 'stock' },
      { treatEmptyAsFailure: false, accept: (r) => !!r && r.name !== code },
    )
  }

  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    const key = 'quotes:' + [...codes].sort().join(',')
    return guarded(
      key,
      EP.FUND_QUOTE,
      () =>
        this.tryFirst(
          (a) => a.fetchQuotes(codes),
          (data) => data.length > 0 && data.some((q) => q.nav !== 1 || q.dailyChange !== 0),
        ),
      [],
      {
        treatEmptyAsFailure: true,
        accept: (data) => data.length > 0 && data.some((q) => q.nav !== 1 || q.dailyChange !== 0),
      },
    )
  }

  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return guarded(
      `kline:${code}:${period}`,
      EP.NAV_KLINE,
      () =>
        this.tryFirst(
          (a) => (typeof a.fetchKLine === 'function' ? a.fetchKLine(code, period) : null),
          (data) => data.length > 0,
        ),
      [],
      { treatEmptyAsFailure: true, accept: (data) => data.length > 0 },
    )
  }

  /**
   * 获取场内 ETF 真实 K 线（必须由支持此接口的适配器提供）
   * 从第一个支持 fetchEtfKLine 的适配器获取，若均不支持则返回空数组
   */
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return guarded(
      `etfkline:${code}:${period}`,
      EP.ETF_KLINE,
      () =>
        this.tryFirst(
          (a) => (typeof a.fetchEtfKLine === 'function' ? a.fetchEtfKLine(code, period) : null),
          (data) => data.length > 0,
        ),
      [],
      { treatEmptyAsFailure: true, accept: (data) => data.length > 0 },
    )
  }

  /**
   * 获取个股真实 K 线（含 OHLC 和成交量）
   * 从第一个支持 fetchStockKLine 的适配器获取
   */
  async fetchStockKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return guarded(
      `stockkline:${code}:${period}`,
      EP.STOCK_KLINE,
      () =>
        this.tryFirst(
          (a) => (typeof a.fetchStockKLine === 'function' ? a.fetchStockKLine(code, period) : null),
          (data) => data.length > 0,
        ),
      [],
      { treatEmptyAsFailure: true, accept: (data) => data.length > 0 },
    )
  }

  /**
   * 获取个股实时行情（现价/涨跌幅）
   * 从第一个支持 fetchStockQuote 的适配器获取
   */
  async fetchStockQuote(code: string): Promise<FundQuote | null> {
    return guarded(
      'stockquote:' + code,
      EP.STOCK_QUOTE,
      () =>
        this.tryFirst((a) =>
          typeof a.fetchStockQuote === 'function' ? a.fetchStockQuote(code) : null,
        ),
      null,
      { treatEmptyAsFailure: false },
    )
  }

  /**
   * 获取基金持仓明细（前十大重仓股）
   */
  async fetchFundPortfolio(fundCode: string): Promise<FundPortfolio | null> {
    return guarded(
      'portfolio:' + fundCode,
      EP.PORTFOLIO,
      () =>
        this.tryFirst((a) =>
          typeof a.fetchFundPortfolio === 'function' ? a.fetchFundPortfolio(fundCode) : null,
        ),
      null,
      { treatEmptyAsFailure: false },
    )
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   */
  async queryEtfMapping(otcCode: string): Promise<EtfMapping | null> {
    return guarded(
      'etfmapping:' + otcCode,
      EP.ETF_MAPPING,
      () =>
        this.tryFirst((a) =>
          typeof a.queryEtfMapping === 'function' ? a.queryEtfMapping(otcCode) : null,
        ),
      null,
      { treatEmptyAsFailure: false },
    )
  }

  /**
   * 搜索股票/基金
   * 通过 stock-api 的 searchStocks 实现关键词搜索
   */
  async searchStocks(key: string): Promise<{ code: string; name: string }[]> {
    return guarded(
      'search:' + key,
      EP.SEARCH,
      () =>
        this.tryFirst(
          (a) => (typeof a.searchStocks === 'function' ? a.searchStocks(key) : null),
          (data) => data.length > 0,
        ),
      [],
      { treatEmptyAsFailure: true, accept: (data) => data.length > 0 },
    )
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
    try {
      const result = await this.tryFirst((a) =>
        typeof a.checkHealth === 'function' ? a.checkHealth() : null,
      )
      if (result) return result
    } catch {
      /* 上游不可用，返回降级健康状态 */
    }
    return {
      stockApi: { ok: false, latency: 0, error: '无适配器支持' },
      fundgz: { ok: false, latency: 0, error: '无适配器支持' },
      pingzhongdata: { ok: false, latency: 0, error: '无适配器支持' },
    }
  }
}

export const dataSourceService = new DataSourceService()
