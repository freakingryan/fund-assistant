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
  holdingAmount: number   // 持有金额（当前总市值，已含收益，方式二）
  holdingProfit: number   // 持有收益（方式二，正数盈利负数亏损，本金 = 持有金额 - 持有收益）
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

/** 基金前十大重仓股 */
export interface FundPortfolio {
  date: string
  holdings: { code: string; name: string; ratio: number; value: number }[]
}

/** 数据源健康检查结果 */
export interface DatasourceHealth {
  stockApi: { ok: boolean; latency: number; error?: string }
  fundgz: { ok: boolean; latency: number; error?: string }
  pingzhongdata: { ok: boolean; latency: number; error?: string }
}

// ============= 投资计划 =============

export type PlanRuleType =
  | 'return'          // 收益率触发
  | 'price_diff'      // 价差绝对值触发（净值 vs 成本）
  | 'daily_change'    // 单日涨跌幅触发
  | 'dca'             // 定期定投触发
  | 'kline_pattern'   // K 线形态 AI 诊断（手动）

export type Comparator = 'lt' | 'gt' | 'lte' | 'gte'

export interface PlanRule {
  id: string
  type: PlanRuleType
  threshold: number       // 阈值（收益率% / 价差绝对值 / 涨跌幅% / 定投间隔天数）
  comparator: Comparator   // 比较方向
  action: 'buy' | 'sell'
  shares: number          // 操作份数（0 表示仅提醒不操作）
  enabled: boolean
}

/**
 * 全局投资计划（所有基金共用一套规则）
 */
export interface InvestmentPlan {
  id: string              // 固定为 'global-plan'
  name: string
  description: string
  rules: PlanRule[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * 规则扫描结果（单条提醒/建议）
 */
export interface PlanAlert {
  id: string
  fundCode: string
  fundName: string
  ruleId: string
  ruleType: PlanRuleType
  action: 'buy' | 'sell'
  shares: number
  currentNAV: number
  costNAV: number
  returnRate: number      // 当前收益率 (%)
  dailyChange: number     // 今日涨跌幅 (%)
  reason: string          // 触发说明
  triggeredAt: string
  executed: boolean
  executedAt?: string
  dismissed: boolean      // 是否已忽略
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

export type AIProvider = 'deepseek' | 'google' | 'openai' | 'groq' | 'openrouter' | 'agnes' | 'custom'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseURL?: string
  model?: string
}

export interface NotionConfig {
  token: string
  databaseId: string
}

export interface UserSettings {
  id?: string           // Dexie 主键，总是 'user-settings'
  theme: 'light' | 'dark' | 'system'
  aiConfigs: AIConfig[]
  defaultAIProvider: AIProvider
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
  sync: {
    gistToken: string     // GitHub Personal Access Token
    gistId: string        // 已创建的 Gist ID，首次推送后自动保存
  }
}

// ============= Prompt 相关 =============

export type PromptTemplateType = 'diagnostic' | 'kline_enhanced' | 'rebalance'

export interface PromptTemplate {
  type: PromptTemplateType
  name: string
  generate(holdings: FundHolding[], quotes: FundQuote[], plans?: InvestmentPlan[]): string
}
