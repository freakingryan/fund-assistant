// ============= 基金持仓 =============

export type FundType =
  | 'stock'       // 股票型
  | 'mixed'       // 混合型
  | 'bond'        // 债券型
  | 'index'       // 指数型
  | 'qdii'        // QDII
  | 'money'       // 货币型
  | 'etf'         // ETF
  | 'other'       // 其他

export type FundSector =
  | 'tech'        // 科技
  | 'consumer'    // 消费
  | 'healthcare'  // 医药
  | 'new_energy'  // 新能源
  | 'finance'     // 金融
  | 'manufacturing' // 制造
  | 'real_estate' // 地产
  | 'broad_market' // 宽基
  | 'bond_market'  // 债市
  | 'global'      // 全球
  | 'commodity'   // 大宗商品
  | 'other'       // 其他

export type Market = 'A' | 'HK' | 'US'

export interface FundHolding {
  id: string
  code: string            // 基金代码
  name: string            // 基金名称
  market: Market          // 所属市场
  type: FundType          // 基金类型
  sector: FundSector      // 投资领域
  costNAV: number         // 持仓成本净值
  shares: number          // 持有份额
  purchaseDate: string    // 购买日期 (YYYY-MM-DD)
  tags: string[]          // 自定义标签
  notes: string           // 备注
  createdAt: string
  updatedAt: string
}

export interface FundQuote {
  code: string
  name: string
  nav: number             // 最新净值
  accNav: number          // 累计净值
  dailyChange: number     // 日涨跌幅 (%)
  navDate: string         // 净值日期
}

export interface KLineData {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export interface EtfMapping {
  otcCode: string         // 场外基金代码
  otcName: string
  exchangeCode: string    // 场内 ETF 代码
  exchangeName: string
}

// ============= 投资计划 =============

export type PlanRuleType = 'profit' | 'loss' | 'daily_drop' | 'daily_rise' | 'dca'

export interface PlanRule {
  id: string
  type: PlanRuleType
  threshold: number       // 触发阈值 (%)
  action: 'buy' | 'sell'
  shares: number          // 操作份数
  enabled: boolean
}

export interface InvestmentPlan {
  id: string
  fundCode: string
  fundName: string
  totalPool: number       // 总资金池
  shareAmount: number     // 单份金额
  rules: PlanRule[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface PlanLog {
  id: string
  planId: string
  fundCode: string
  fundName: string
  ruleId: string
  action: 'buy' | 'sell'
  shares: number
  nav: number
  reason: string
  triggeredAt: string
  executed: boolean
  executedAt?: string
}

// ============= AI / 存储 / 数据源 适配器接口 =============

export interface StorageAdapter {
  id: string
  name: string
  type: 'holdings' | 'plans' | 'settings' | 'all'
  save(key: string, data: unknown): Promise<void>
  load(key: string): Promise<unknown>
  delete(key: string): Promise<void>
  sync(): Promise<void>
  isConfigured(): boolean
}

export type AIProvider = 'deepseek' | 'google' | 'openai' | 'custom'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseURL?: string
  model?: string
}

export interface DataSourceConfig {
  tushareToken: string
  primarySource: 'tushare' | 'westock' | 'neodata'
}

export interface NotionConfig {
  token: string
  databaseId: string
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system'
  aiConfigs: AIConfig[]
  defaultAIProvider: AIProvider
  dataSource: DataSourceConfig
  storage: {
    type: 'local' | 'notion'
    notion?: NotionConfig
  }
  notifications: {
    browser: boolean
    feishu: boolean
    schedule: string  // cron expression
  }
  etfMappings: EtfMapping[]
}

// ============= Prompt 相关 =============

export type PromptTemplateType = 'diagnostic' | 'kline_enhanced' | 'rebalance'

export interface PromptTemplate {
  type: PromptTemplateType
  name: string
  generate(holdings: FundHolding[], quotes: FundQuote[], plans?: InvestmentPlan[]): string
}
