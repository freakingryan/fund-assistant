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
  | 'trend'           // 决策引擎趋势评分触发（0-100）

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

// ============= 每日日报 =============

/** 单只持仓的盈亏明细（日报模块1） */
export interface HoldingPnlItem {
  code: string
  name: string
  nav: number
  dailyChange: number   // 今日涨跌幅 (%)
  costNAV: number       // 估算成本净值（方式二可能为 0）
  shares: number
  returnRate: number    // 当前收益率 (%)
  marketValue: number   // 当前市值
  costValue: number     // 本金（成本市值）
  dayPnl: number        // 今日盈亏
  totalPnl: number      // 累计盈亏
  costKnown: boolean    // 成本是否已知（costNAV>0）。false 时收益率/累计盈亏无意义，UI 显示「成本未知」并从成本类聚合中剔除
}

/** 组合盈亏快照（日报模块1） */
export interface PortfolioSnapshot {
  date: string
  totalMarketValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  dayPnl: number
  dayPnlPct: number
  prevDayMarketValue: number | null   // 昨日组合市值（来自上一期日报，无则 null）
  dayPnlByPrev: number | null         // 较昨日市值增减
  prevDate: string | null
  holdings: HoldingPnlItem[]
}

export type PlanProgressStatus = 'reached' | 'near' | 'far' | 'na' | 'disabled'

/** 单条计划的当前进度（日报模块3） */
export interface PlanProgressItem {
  ruleId: string
  ruleType: PlanRuleType
  threshold: number
  comparator: Comparator
  action: 'buy' | 'sell'
  enabled: boolean
  currentValue: number | null         // 当前指标值（组合/平均/天数）
  distance: number | null             // threshold - currentValue
  reached: boolean
  status: PlanProgressStatus
  note: string
}

/** 板块温度单项（日报模块4） */
export interface SectorTempItem {
  name: string
  changePercent: number | null        // 板块当日涨跌幅 (%)
  score: number | null                // 0-100（±4.17% 映射到 0-100）
  source: 'industry' | 'concept'
}

/** 当日技术信号事件（日报模块4） */
export interface MarketSignalItem {
  code: string
  name: string
  type: string
  label: string
  date: string
  direction: 'up' | 'down' | 'neutral'
}

/** 板块温度 + 当日信号（日报模块4） */
export interface MarketPulse {
  sectorEnabled: boolean              // 东财增强是否开启
  sectorTemp: SectorTempItem[]
  avgSectorScore: number | null       // 持仓市值加权的板块温度均分
  signals: MarketSignalItem[]
  lowConfidenceCount: number          // 基于净值（无盘中区间）的基金数
}

/** 每日日报（主键 date = YYYY-MM-DD，幂等） */
export interface DailyReport {
  date: string
  portfolio: PortfolioSnapshot
  suggestions: PlanAlert[]            // 模块2：当日行动建议（待处理 alert）
  planProgress: PlanProgressItem[]    // 模块3
  market: MarketPulse                 // 模块4
  generatedAt: string
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
  sync: SyncConfig
  /** 数据源增强配置（门控型能力，默认关闭） */
  dataSource: DataSourceSettings
  /** 评分回测模块元数据（自动采集守卫等） */
  backtest?: {
    /** 上次自动采集的日期 YYYY-MM-DD，用于「每日首次」守卫避免重复尝试 */
    lastAutoCaptureDate: string | null
  }
}

/** 数据源增强配置 */
export interface DataSourceSettings {
  /**
   * 东方财富资金面增强（资金流向 / 北向 / 板块 / 龙虎榜 / 融资融券）。
   * 这些能力底层均走东方财富（与行情/K线 走腾讯不同），默认关闭。
   * 开启后：经重仓股/ETF 映射间接分析基金资金面，写入评分快照，供排行榜排序。
   * 默认关闭——当前网络到不了东财时不产生任何东财请求，App 行为与关闭前一致。
   */
  eastmoney: EastmoneyDataSourceConfig
}

export interface EastmoneyDataSourceConfig {
  /** 是否启用东财资金面增强，默认 false */
  enabled: boolean
  /** direct=直连东财（网络可直连时）；proxy=经 Cloudflare Worker 反代（部署 Worker 后） */
  mode: 'direct' | 'proxy'
  /** Worker 反代地址（mode=proxy 时必填）。约定：Worker 转发时保留原始 path+query */
  proxyUrl: string
}

/** GitHub Gist 同步配置 */
export interface SyncConfig {
  gistToken: string     // GitHub Personal Access Token
  gistId: string        // 已创建的 Gist ID，首次推送后自动保存
  autoPush?: boolean    // 是否启用每日自动推送（默认开启）
  lastAutoPush?: number | null      // 上次成功自动推送的时间戳
  lastAutoPushAttempt?: number | null // 上次尝试（含失败）时间戳，用于失败退避
}

/** 应用内通知（展示于右上角铃铛浮窗） */
export interface AppNotification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  body?: string
  createdAt: number
  read: boolean
}

// ============= Prompt 相关 =============

export type PromptTemplateType = 'diagnostic' | 'kline_enhanced' | 'rebalance'

export interface PromptTemplate {
  type: PromptTemplateType
  name: string
  generate(holdings: FundHolding[], quotes: FundQuote[], plans?: InvestmentPlan[]): string
}
