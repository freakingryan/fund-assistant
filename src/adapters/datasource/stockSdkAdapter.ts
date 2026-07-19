/**
 * 行情 / K 线 / 基金数据统一适配器（迁移目标 / 单一真相来源）
 *
 * 结合两个第三方库、零自管 fetch/JSONP/重试逻辑：
 *  - K 线（场内 ETF / 个股）：走 stock-api 的 `stocks.auto.getKlines`
 *    （默认 tencent → sina → eastmoney 自动兜底；浏览器下腾讯源自动切
 *    JSONP 适配绕开 CORS；端点 web.ifzq.gtimg.cn 在用户网络可达）。
 *    —— stock-sdk 的 kline.cn 写死东财 push2his，用户网络到不了，故 K 线用 stock-api。
 *  - 股票/ETF 行情：走 stock-api 的 `stocks.auto.getStocks`（腾讯优先、三源兜底）主源 +
 *    stock-sdk 的 `quotes.cn` 兜底（见 crossLibFallback）。
 *  - 基金净值/估值/行情/F10/搜索等：走 stock-sdk 原生方法；受东财网络阻塞（用户网络到不了
 *    东财），当前不可达，按决策 1 回退旧 JSONP 兜底（选项 3 保留相关代码不删）。
 *
 * 迁移节奏（见仓库根 stock-sdk-migration-plan.md）：
 *  - P1 ✅：K 线切到 stock-api（解决 push2his 不可达）。
 *  - P2 ✅：基金净值历史优先 stock-sdk（东财不可达 → 回退 JSONP）。
 *  - P3 🔄：股票/ETF 行情改直连 stock-api（主）+ stock-sdk.quotes.cn（兜底），不再委托旧适配器。
 *  - P4 🔄：搜索 searchStocks 改直连 stock-api（主）+ stock-sdk.search（兜底）；
 *    基金域接口（fetchFundInfo/fetchFundPortfolio/queryEtfMapping）受东财阻塞 + 选项 3 保持委托旧适配器。
 *
 * 周期映射：本应用按交易日计数（1m/3m/6m/1y → 22/66/132/250，见 periodConfig.ts），
 * stock-api 的 getKlines 直接按 count 返回日 K（period:'day'），adjust 取 'qfq'。
 */
import StockSDK from 'stock-sdk'
import { stocks } from 'stock-api'
import { withCrossLibFallback } from './crossLibFallback'
import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { periodToCount } from './periodConfig'
import { stockApiAdapter } from './stock-api'

// 单例：SDK 内部自带代码表/交易日历/缓存与请求治理，全应用共享一个实例。
// 注：stock-sdk 的基金数据（navHistory/profile/estimate）底层均走东财
// （pingzhongdata / fundfz）；若用户网络到不了东财，这些接口会失败，
// 此时按决策 1 回退到 stock-api 适配器的旧 JSONP 实现。
const sdk = new StockSDK()

/**
 * A 股 6 位代码 → 带市场前缀（大写，与 stock-api 代码格式一致：
 * 51/56/58/6/9 → SH，15/16/0/3/2 → SZ，4/8 → BJ）。已带前缀则原样返回。
 */
function toMarketPrefixedCode(rawCode: string): string {
  const code = rawCode.replace(/^(sh|sz|bj|SH|SZ|BJ)/, '').trim()
  if (!/^\d{6}$/.test(code)) return rawCode.toUpperCase()
  if (/^(51|56|58)/.test(code) || /^[69]/.test(code)) return `SH${code}`
  if (/^(15|16)/.test(code) || /^[032]/.test(code)) return `SZ${code}`
  if (/^[48]/.test(code)) return `BJ${code}`
  return code.toUpperCase()
}

/**
 * 判断是否为「明确的场内交易品种」码（ETF/LOF 或带市场前缀的个股/ETF）。
 * 用于 fetchQuotes 批量分流：这些码与场外基金码前缀无重叠（159/16/51/56/58 不会是
 * 场外基金码），可安全走 stock-api 股票行情接口；其余 6 位码（含 000001 等基金与
 * 600519 等个股）前缀重叠、无法仅凭代码区分，交回旧适配器处理。
 */
function isExchangeLike(code: string): boolean {
  return /^(SH|SZ|BJ)/i.test(code) || /^(159|16|51|56|58)/.test(code)
}

/** 将 stock-api 的 Stock 行情对象映射为 FundQuote（nav=现价；dailyChange=涨跌幅%，percent 为小数需 ×100）。 */
function toQuoteFromStockApi(
  stock: { name: string; now: number; percent?: number },
  code: string,
): FundQuote {
  return {
    code,
    name: stock.name,
    nav: stock.now,
    accNav: 0,
    dailyChange: (stock.percent ?? 0) * 100,
    navDate: new Date().toISOString().slice(0, 10),
  }
}

/** 将 stock-sdk 的行情对象映射为 FundQuote（nav=现价；changePercent 已是百分比，无需 ×100）。 */
function toQuoteFromSdk(
  r: { name: string; price?: number; changePercent?: number },
  code: string,
): FundQuote {
  return {
    code,
    name: r.name,
    nav: r.price ?? 0,
    accNav: 0,
    dailyChange: r.changePercent ?? 0,
    navDate: new Date().toISOString().slice(0, 10),
  }
}

class StockSdkAdapter implements FundDataSource {
  name = 'stock-sdk+stock-api'

  isConfigured(): boolean {
    return true
  }

  // ── P1：场内 ETF / 个股真实 K 线（SDK 原生） ──────────────────────────
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return this.fetchCnKline(code, period)
  }

  async fetchStockKLine(code: string, period = '3m'): Promise<KLineData[]> {
    return this.fetchCnKline(code, period)
  }

  /**
   * 统一实现：场内 ETF / 个股 K 线 → stock-api `stocks.auto.getKlines`。
   * 默认 tencent → sina → eastmoney 自动兜底；浏览器下腾讯源自动切 JSONP
   * 适配绕开 CORS；端点 web.ifzq.gtimg.cn 在用户网络可达。
   * （stock-sdk 的 kline.cn 写死东财 push2his，用户网络到不了，故不用。）
   * stock-api 直接按 count 返回日 K（period:'day'，adjust:'qfq'），与 KLineData 一一对应。
   */
  private async fetchCnKline(rawCode: string, period: string): Promise<KLineData[]> {
    const symbol = toMarketPrefixedCode(rawCode)
    if (!/^(SH|SZ|BJ)\d{6}$/.test(symbol)) return []
    const count = periodToCount(period)
    try {
      const klines = await stocks.auto.getKlines(symbol, {
        period: 'day',
        count,
        adjust: 'qfq',
      })
      if (!Array.isArray(klines) || klines.length === 0) return []
      // 防御性取尾部 count 根（腾讯通常按 count 返回，但留余量）
      return klines.slice(-count).map((k) => ({
        date: k.date,
        open: k.open ?? 0,
        close: k.close ?? 0,
        high: k.high ?? 0,
        low: k.low ?? 0,
        volume: k.volume ?? 0,
      }))
    } catch (e) {
      console.error(`[StockSdkAdapter] K线获取失败: ${symbol}`, e)
      return []
    }
  }

  // ── 行情：股票/ETF 走 stock-api（主）+ stock-sdk.quotes.cn（兜底），不再委托旧适配器 ──
  // 基金净值/估值/F10/搜索/映射 仍委托 stock-api 适配器（含东财 JSONP 兜底，选项 3 保留）。
  // fetchKLine 已在 P2 迁到 sdk.fund.navHistory（旧 JSONP 兜底）。

  /**
   * 股票/ETF 实时行情（批量）。
   * - 场内 ETF/LOF 及带市场前缀的码 → stock-api（腾讯优先，三源兜底）主源 + stock-sdk.quotes.cn 兜底。
   * - 其余 6 位码（场外基金等）→ 委托旧适配器 fundgz 路径（选项 3 保留，东财不可达时回退）。
   * 说明：纯 6 位个股码（如 600519）与场外基金码（如 000001）前缀重叠、无法仅凭代码区分，
   * 故个股行情请走 `fetchStockQuote`（单只，明确为股票）；批量 `fetchQuotes` 仅对明确的
   * 场内 ETF/LOF 码走 stock-api，避免把基金码误发到股票接口导致取数失败。
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    const exchangeCodes = codes.filter(isExchangeLike)
    const rest = codes.filter((c) => !isExchangeLike(c))
    const results: FundQuote[] = []
    if (exchangeCodes.length > 0) {
      results.push(...(await this.fetchExchangeQuotes(exchangeCodes)))
    }
    if (rest.length > 0) {
      results.push(...(await stockApiAdapter.fetchQuotes(rest)))
    }
    return results
  }

  /**
   * 单只股票/ETF 实时行情：stock-api（主）+ stock-sdk.quotes.cn（兜底）。
   * 返回 FundQuote 兼容结构（nav=现价，dailyChange=涨跌幅%）。
   */
  async fetchStockQuote(code: string): Promise<FundQuote | null> {
    const quotes = await this.fetchExchangeQuotes([code])
    return quotes.length > 0 ? quotes[0] : null
  }

  /**
   * 批量场内行情：stock-api 主 + stock-sdk.quotes.cn 兜底，按原始码顺序映射为 FundQuote[]。
   */
  private async fetchExchangeQuotes(codes: string[]): Promise<FundQuote[]> {
    const symbols = codes.map(toMarketPrefixedCode)
    return withCrossLibFallback(
      async () => {
        const list = await stocks.auto.getStocks(symbols)
        const out: FundQuote[] = []
        for (let i = 0; i < codes.length; i++) {
          const s = list?.[i]
          if (s && s.now > 0 && s.name) out.push(toQuoteFromStockApi(s, codes[i]))
        }
        return out
      },
      async () => {
        const list = await sdk.quotes.cn(symbols)
        const out: FundQuote[] = []
        for (let i = 0; i < codes.length; i++) {
          const r = list?.[i]
          if (r && r.name) out.push(toQuoteFromSdk(r, codes[i]))
        }
        return out
      },
      'exchangeQuotes',
    )
  }

  async fetchFundInfo(code: string) {
    return stockApiAdapter.fetchFundInfo(code)
  }

  /**
   * 场外基金历史净值走势 → 优先 stock-sdk（东财 pingzhongdata），
   * 失败/空则回退旧 pingzhongdata JSONP（决策 1：可达性未确认前保留兜底）。
   * SDK 返回的 FundNavPoint 仅含 date/nav，映射为 KLineData（open=close=high=low=nav，volume=0）。
   */
  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    try {
      const nav = await sdk.fund.navHistory(code)
      if (!nav || !Array.isArray(nav.items) || nav.items.length === 0) {
        return stockApiAdapter.fetchKLine(code, period)
      }
      return nav.items.map((p) => {
        const v = p.nav ?? 0
        return { date: p.date, open: v, close: v, high: v, low: v, volume: 0 }
      })
    } catch (e) {
      console.warn(`[StockSdkAdapter] 净值获取失败，回退 JSONP: ${code}`, e)
      return stockApiAdapter.fetchKLine(code, period)
    }
  }

  async fetchFundPortfolio(fundCode: string) {
    return stockApiAdapter.fetchFundPortfolio(fundCode)
  }

  async queryEtfMapping(otcCode: string) {
    return stockApiAdapter.queryEtfMapping(otcCode)
  }

  /**
   * 关键词搜索股票/ETF/基金 → stock-api `stocks.auto.searchStocks`（腾讯 smartbox，用户网络可达）主源
   * + stock-sdk `sdk.search`（兜底，底层东财、当前不可达时不影响主源结果）。
   * 映射为统一 `{ code, name }[]`；主源 code 格式 SH600519（大写），兜底 sh600519（小写）统一转大写。
   * 注：空结果 `[]` 属合法「无匹配」，用自定义 validator 避免误触发兜底。
   */
  async searchStocks(key: string) {
    if (!key || !key.trim()) return []
    return withCrossLibFallback(
      async () => {
        const list = await stocks.auto.searchStocks(key.trim())
        return Array.isArray(list)
          ? list.map((s) => ({ code: s.code, name: s.name }))
          : []
      },
      async () => {
        const list = await sdk.search(key.trim())
        return Array.isArray(list)
          ? list.map((s) => ({ code: s.code.toUpperCase(), name: s.name }))
          : []
      },
      'searchStocks',
      (r) => Array.isArray(r), // 任意数组（含空）即有效，不误触发兜底
    )
  }

  async checkHealth() {
    return stockApiAdapter.checkHealth()
  }
}

export const stockSdkAdapter = new StockSdkAdapter()
