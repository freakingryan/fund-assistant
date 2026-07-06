import type { DatasourceHealth, EtfMapping, FundPortfolio, FundQuote, KLineData } from '@/types'

export interface FundDataSource {
  name: string
  fetchFundInfo(code: string): Promise<{ name: string; type: string }>
  fetchQuotes(codes: string[]): Promise<FundQuote[]>

  /**
   * 净值走势 K 线。
   * 标记为可选：并非所有数据源都能提供（如东方财富 JSONP 仅作兜底，无 K 线能力）。
   * 调用方（DataSourceService）会按 `typeof adapter.fetchKLine === 'function'` 守卫。
   */
  fetchKLine?(code: string, period?: string): Promise<KLineData[]>

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

  /** 基金前十大重仓股（含占净值比例） */
  fetchFundPortfolio?(fundCode: string): Promise<FundPortfolio | null>

  /** 场外基金 → 对应场内 ETF 映射 */
  queryEtfMapping?(otcCode: string): Promise<EtfMapping | null>

  /** 按关键词搜索股票/基金代码 */
  searchStocks?(key: string): Promise<{ code: string; name: string }[]>

  /** 检查各数据源健康状态（延迟 / 可用性） */
  checkHealth?(): Promise<DatasourceHealth>

  /** 数据源是否已配置 */
  isConfigured(): boolean
}
