import type { FundQuote, KLineData } from '@/types'

export interface FundDataSource {
  name: string
  fetchFundInfo(code: string): Promise<{ name: string; type: string }>
  fetchQuotes(codes: string[]): Promise<FundQuote[]>
  fetchKLine(code: string, period?: string): Promise<KLineData[]>

  /**
   * 获取场内 ETF 真实 K 线（含 OHLC 和成交量）
   * @param code ETF 代码
   * @param period 周期：1m, 3m, 6m, 1y
   */
  fetchEtfKLine?(code: string, period?: string): Promise<KLineData[]>

  /**
   * 获取个股真实 K 线（含 OHLC 和成交量）
   * @param code 普通 6 位股票代码（如 600519）
   * @param period 周期：1m, 3m, 6m, 1y
   */
  fetchStockKLine?(code: string, period?: string): Promise<KLineData[]>

  /**
   * 获取个股实时行情（现价/涨跌幅）
   * @param code 普通 6 位股票代码
   */
  fetchStockQuote?(code: string): Promise<FundQuote | null>

  /** 数据源是否已配置 */
  isConfigured(): boolean
}
