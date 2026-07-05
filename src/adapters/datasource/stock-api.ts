/**
 * stock-api 数据源适配器
 *
 * 直接在前端浏览器中调用腾讯/新浪/东方财富的行情接口，无需后端服务。
 * 安装：npm install stock-api
 * 文档：https://github.com/zhangxiangliang/stock-api
 *
 * 数据源优先级：腾讯 → 新浪 → 东方财富（stocks.auto 自动兜底）
 *
 * 代码格式：SH510500（沪市）、SZ159558（深市）、HK02020（港股）、USDJI（美股）
 */
import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'

// stock-api 是 ESM-only 库，动态 import 以适应项目构建配置
let stocks: any = null

async function ensureStocks() {
  if (!stocks) {
    stocks = await import('stock-api').then((m) => m.stocks)
  }
  return stocks
}

/**
 * 将场内 ETF 代码转换为 stock-api 格式（带市场前缀）
 * 159xxx → SZ159xxx（深交所）
 * 51xxxx → SH51xxxx（上交所）
 * 其他原样返回
 */
function toApiCode(code: string): string {
  if (code.startsWith('159') || code.startsWith('16')) return `SZ${code}`
  if (code.startsWith('51') || code.startsWith('56')) return `SH${code}`
  return code
}

/**
 * 计算 period 对应的 K 线条数
 */
function periodToCount(period: string): number {
  switch (period) {
    case '1m': return 30
    case '3m': return 66
    case '6m': return 130
    case '1y': return 250
    default: return 66
  }
}

export class StockApiAdapter implements FundDataSource {
  name = 'stock-api'

  isConfigured(): boolean {
    return true // 纯前端库，始终可用
  }

  /**
   * 从字段名中提取：stock-api 返回的 Stock 接口
   * { code, name, now, low, high, percent, yesterday, source }
   */
  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    try {
      const s = await ensureStocks()
      const apiCode = toApiCode(code)
      const stock = await s.auto.getStock(apiCode)
      if (stock && stock.name) {
        const type = code.startsWith('159') || code.startsWith('51') ? '指数型' : '其他'
        return { name: stock.name, type }
      }
    } catch { /* fallback */ }
    return { name: code, type: '其他' }
  }

  /**
   * 获取实时行情
   * 适用于场内 ETF：通过 stocks.auto.getStocks 实时行情
   * 返回 FundQuote 格式（兼容基金净值）
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    try {
      const s = await ensureStocks()
      const apiCodes = codes.map(toApiCode)
      const stocksList = await s.auto.getStocks(apiCodes)

      return codes.map((code, i) => {
        const stock = stocksList[i]
        if (stock && stock.now > 0 && stock.name) {
          return {
            code,
            name: stock.name,
            // stock-api 的 percent 是小数格式（0.01 = 1%），转为百分比
            nav: stock.now,
            accNav: 0,
            dailyChange: stock.percent * 100,
            navDate: new Date().toISOString().slice(0, 10),
          }
        }
        return { code, name: `ETF ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' }
      })
    } catch { return [] }
  }

  /**
   * 净值走势 K 线
   * 通过 stock-api 的 getKlines 获取
   */
  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    try {
      const s = await ensureStocks()
      const apiCode = toApiCode(code)
      const count = periodToCount(period)
      const klines = await s.auto.getKlines(apiCode, { period: 'day', count })

      if (klines.length > 0) {
        return klines.map((k: any) => ({
          date: k.date || '',
          open: k.open || 0,
          close: k.close || 0,
          high: k.high || 0,
          low: k.low || 0,
          volume: k.volume || 0,
        }))
      }
    } catch { /* fallback */ }
    return []
  }

  /**
   * 场内 ETF 真实 K 线（OHLC + 成交量）
   * 通过 stocks.tencent.getKlines 获取最可靠的 K 线数据
   */
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    try {
      const s = await ensureStocks()
      const apiCode = toApiCode(code)
      const count = periodToCount(period)

      // 优先使用腾讯数据源（最稳定）
      const klines = await s.tencent.getKlines(apiCode, { period: 'day', count })

      if (klines.length > 0) {
        return klines.map((k: any) => ({
          date: k.date || '',
          open: k.open || 0,
          close: k.close || 0,
          high: k.high || 0,
          low: k.low || 0,
          volume: k.volume || 0,
        }))
      }
    } catch { /* fallback to auto */ }

    // 腾讯失败，走 auto 兜底
    try {
      const s = await ensureStocks()
      const apiCode = toApiCode(code)
      const count = periodToCount(period)
      const klines = await s.auto.getKlines(apiCode, { period: 'day', count })

      if (klines.length > 0) {
        return klines.map((k: any) => ({
          date: k.date || '',
          open: k.open || 0,
          close: k.close || 0,
          high: k.high || 0,
          low: k.low || 0,
          volume: k.volume || 0,
        }))
      }
    } catch { /* fallback */ }
    return []
  }

  /**
   * 搜索股票/基金
   * 通过 stocks.auto.searchStocks 实现关键词搜索
   */
  async searchStocks(key: string): Promise<{ code: string; name: string }[]> {
    try {
      const s = await ensureStocks()
      const results = await s.auto.searchStocks(key)
      return results.map((r: any) => ({
        code: r.code || '',
        name: r.name || '',
      })).filter((r: any) => r.code && r.name)
    } catch { return [] }
  }
}

export const stockApiAdapter = new StockApiAdapter()
