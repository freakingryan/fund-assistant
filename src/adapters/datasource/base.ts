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

  /** 数据源是否已配置 */
  isConfigured(): boolean
}
