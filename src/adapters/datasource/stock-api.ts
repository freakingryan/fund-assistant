/**
 * stock-api 数据源适配器
 *
 * 直接在前端浏览器中调用腾讯/新浪/东方财富的行情接口，无需后端服务。
 * 安装：npm install stock-api
 * 文档：https://github.com/zhangxiangliang/stock-api
 *
 * 数据源优先级：
 * - ETF/股票 → stock-api（腾讯 → 新浪 → 东方财富 自动兜底）
 * - 场外基金 → fundgz.1234567.com.cn（天天基金实时估算净值）
 *
 * 代码格式：SH510500（沪市）、SZ159558（深市）、HK02020（港股）、USDJI（美股）
 */
import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { fetchFundGzJsonp, fetchFundPingZhongData } from './jsonp-utils'

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

/** 判断是否为场内 ETF/LOF 代码 */
function isExchangeCode(code: string): boolean {
  return code.startsWith('159') || code.startsWith('51') || code.startsWith('56') || code.startsWith('16')
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

/**
 * 从 fundgz.1234567.com.cn 获取场外基金实时估算净值
 * 返回格式：jsonpgz({ fundcode, name, jzrq, dwjz, gsz, gszzl, gztime })
 * 使用 JSONP 方式（<script> 标签加载）规避 CORS 限制
 */
async function fetchFundGzQuote(code: string): Promise<FundQuote | null> {
  console.log(`[fetchFundGzQuote] 开始获取基金 ${code} 的实时估值`)
  try {
    const data = await fetchFundGzJsonp(code)
    if (!data || data.fundcode !== code) {
      console.warn(`[fetchFundGzQuote] 基金 ${code} 数据无效:`, data)
      return null
    }

    const gsz = Number(data.gsz) || 0
    const gszzl = Number(data.gszzl) || 0
    const dwjz = Number(data.dwjz) || 0

    console.log(`[fetchFundGzQuote] ✅ 基金 ${code} 实时估值: gsz=${gsz}, gszzl=${gszzl}%, dwjz=${dwjz}`)

    return {
      code,
      name: String(data.name || code),
      nav: gsz > 0 ? gsz : dwjz,
      accNav: 0,
      dailyChange: gszzl,
      navDate: String(data.gztime || data.jzrq || '').slice(0, 10),
    }
  } catch (error) {
    console.error(`[fetchFundGzQuote] ❌ 基金 ${code} 获取失败:`, error)
    return null
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
   * - 场内 ETF/股票 → stock-api（腾讯接口实时行情）
   * - 场外基金 → fundgz.1234567.com.cn（天天基金实时估算净值）
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    console.log(`[StockApiAdapter.fetchQuotes] 开始获取 ${codes.length} 个代码的行情:`, codes)
    
    if (codes.length === 0) return []

    const etfCodes = codes.filter(isExchangeCode)
    const fundCodes = codes.filter((c) => !isExchangeCode(c))
    const results: FundQuote[] = []

    console.log(`[StockApiAdapter.fetchQuotes] ETF代码(${etfCodes.length}个):`, etfCodes)
    console.log(`[StockApiAdapter.fetchQuotes] 基金代码(${fundCodes.length}个):`, fundCodes)

    // 1) 场内 ETF：通过 stock-api 获取实时行情
    if (etfCodes.length > 0) {
      try {
        console.log(`[StockApiAdapter.fetchQuotes] 正在获取ETF实时行情...`)
        const s = await ensureStocks()
        const apiCodes = etfCodes.map(toApiCode)
        const stocksList = await s.auto.getStocks(apiCodes)
        console.log(`[StockApiAdapter.fetchQuotes] ETF行情结果:`, stocksList)
        
        for (let i = 0; i < etfCodes.length; i++) {
          const stock = stocksList[i]
          if (stock && stock.now > 0 && stock.name) {
            results.push({
              code: etfCodes[i],
              name: stock.name,
              nav: stock.now,
              accNav: 0,
              dailyChange: stock.percent * 100,
              navDate: new Date().toISOString().slice(0, 10),
            })
          }
        }
        console.log(`[StockApiAdapter.fetchQuotes] ✅ 成功获取 ${results.length} 个ETF行情`)
      } catch (error) {
        console.error(`[StockApiAdapter.fetchQuotes] ❌ ETF行情获取失败:`, error)
        /* fallback to fundgz */
      }
    }

    // 2) 场外基金：通过 fundgz.1234567.com.cn 获取实时估算净值
    if (fundCodes.length > 0) {
      console.log(`[StockApiAdapter.fetchQuotes] 正在获取场外基金实时估值...`)
      const fundQuotes = await Promise.allSettled(fundCodes.map(fetchFundGzQuote))
      
      console.log(`[StockApiAdapter.fetchQuotes] 场外基金估值结果:`, fundQuotes)
      
      for (let i = 0; i < fundCodes.length; i++) {
        const q = fundQuotes[i]
        if (q.status === 'fulfilled' && q.value) {
          results.push(q.value)
        } else {
          console.warn(`[StockApiAdapter.fetchQuotes] 基金 ${fundCodes[i]} 获取失败:`, q)
        }
      }
      console.log(`[StockApiAdapter.fetchQuotes] ✅ 成功获取 ${fundCodes.length} 个基金中的 ${results.length - etfCodes.length} 个`)
    }

    console.log(`[StockApiAdapter.fetchQuotes] 最终结果: ${results.length} 条行情数据`)
    return results
  }

  /**
   * 净值走势 K 线
   * - 场内 ETF → stock-api（腾讯/新浪/东方财富自动兜底）
   * - 场外基金 → fund.eastmoney.com/pingzhongdata/{code}.js（历史净值）
   */
  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    // 场外基金：从 pingzhongdata JS 获取净值走势
    if (!isExchangeCode(code)) {
      try {
        const vars = await fetchFundPingZhongData(code)
        const trend = vars['Data_netWorthTrend']
        if (Array.isArray(trend) && trend.length > 0) {
          return trend.map((item: any) => {
            // JS 数据格式：{x: timestamp_ms, y: nav, equityReturn: change%}
            const ts = item.x
            const date = ts ? new Date(ts).toISOString().slice(0, 10) : ''
            const nav = Number(item.y) || 0
            return {
              date,
              open: nav,
              close: nav,
              high: nav,
              low: nav,
              volume: 0,
            }
          })
        }
      } catch { /* fallback */ }
      return []
    }

    // 场内 ETF：通过 stock-api 获取
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
   * 获取基金持仓明细（前十大重仓股）
   * 通过 fund.eastmoney.com/pingzhongdata/{code}.js 获取
   * 数据来源：Data_fundSharesPositions, stockCodes
   */
  async fetchFundPortfolio(fundCode: string): Promise<{
    date: string
    holdings: { code: string; name: string; ratio: number; value: number }[]
  } | null> {
    try {
      const vars = await fetchFundPingZhongData(fundCode)
      const positions = vars['Data_fundSharesPositions']
      const stockNames = vars['stockCodes'] || vars['stockCodesNew'] || []

      if (!Array.isArray(positions) || positions.length === 0) return null
      // stockCodes 格式：{ code: 'sz000651', name: '格力电器' }

      const holdings = positions.map((item: any) => {
        // Data_fundSharesPositions: [{code, name, position, marketValue, ...}]
        const stCode = String(item.code || item.stockCode || '')
        // 查找股票名称
        const nameMap = Array.isArray(stockNames)
          ? stockNames.find((s: any) => s.code === stCode || s.code === `sz${stCode}` || s.code === `sh${stCode}`)
          : null
        return {
          code: stCode,
          name: nameMap?.name || item.name || '',
          ratio: Number(item.position || item.ratio || 0),
          value: Number(item.marketValue || item.value || 0),
        }
      }).filter((h: any) => h.name || h.code).slice(0, 10)

      return { date: '', holdings }
    } catch { return null }
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   * 通过 stock-api 搜索匹配（根据基金名称关键词找到对应 ETF）
   */
  async queryEtfMapping(otcCode: string): Promise<{
    otcCode: string
    otcName: string
    exchangeCode: string
    exchangeName: string
  } | null> {
    try {
      // 通过 fundgz 获取基金名称
      const fundData = await fetchFundGzJsonp(otcCode)
      if (!fundData?.name) return null
      const otcName: string = fundData.name

      // 从名称提取关键词（去掉 "联接" "ETF" "C" 等）
      const keyword = otcName
        .replace(/ETF/i, '').replace(/联接/i, '')
        .replace(/C$/, '').replace(/A$/, '')
        .replace(/\(QDII\)/i, '').replace(/指数/i, '')
        .trim()

      // 通过 stock-api 搜索匹配的 ETF
      const s = await ensureStocks()
      const results = await s.auto.searchStocks(keyword)
      // 过滤出 ETF 代码（159xxx / 51xxx）
      const etf = results.find((r: any) => {
        const c = r.code?.replace(/^(SZ|SH)/, '')
        return c && (c.startsWith('159') || c.startsWith('51'))
      })
      if (!etf) return null

      const exCode = etf.code?.replace(/^(SZ|SH)/, '') || ''
      return { otcCode, otcName, exchangeCode: exCode, exchangeName: etf.name || '' }
    } catch { return null }
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

  /**
   * 检查各数据源健康状态
   * 返回每个数据源的可用状态和延迟（毫秒）
   */
  async checkHealth(): Promise<{
    stockApi: { ok: boolean; latency: number; error?: string }
    fundgz: { ok: boolean; latency: number; error?: string }
    pingzhongdata: { ok: boolean; latency: number; error?: string }
  }> {
    const result = {
      stockApi: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
      fundgz: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
      pingzhongdata: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
    }

    // 1) stock-api: 尝试获取一个已知 ETF 的行情
    try {
      const t0 = performance.now()
      const s = await ensureStocks()
      await s.auto.getStock('SZ159558')
      result.stockApi.ok = true
      result.stockApi.latency = Math.round(performance.now() - t0)
    } catch (e: any) {
      result.stockApi.error = e.message || String(e)
    }

    // 2) fundgz: 尝试获取一个已知基金的实时估值
    try {
      const t0 = performance.now()
      await fetchFundGzJsonp('000001')
      result.fundgz.ok = true
      result.fundgz.latency = Math.round(performance.now() - t0)
    } catch (e: any) {
      result.fundgz.error = e.message || String(e)
    }

    // 3) pingzhongdata: 尝试获取一个已知基金的历史数据（只测连通性）
    try {
      const t0 = performance.now()
      const vars = await fetchFundPingZhongData('000001')
      result.pingzhongdata.ok = !!vars['Data_netWorthTrend']
      result.pingzhongdata.latency = Math.round(performance.now() - t0)
      if (!result.pingzhongdata.ok) result.pingzhongdata.error = '净值数据为空'
    } catch (e: any) {
      result.pingzhongdata.error = e.message || String(e)
    }

    return result
  }
}

export const stockApiAdapter = new StockApiAdapter()
