import type { FundHolding, FundQuote, PlanAlert, EtfMapping, KLineData } from '@/types'
import { detectPatterns, formatPatternsSummary } from '@/services/klinePatterns'
import { TYPE_LABELS, SECTOR_LABELS, MARKET_LABELS } from '@/lib/labels'

export type PromptTemplateType = 'diagnostic' | 'rebalance' | 'kline_enhanced'

export interface GeneratePromptOptions {
  templateType: PromptTemplateType
  holdings: FundHolding[]
  quotes: FundQuote[]
  selectedIds: string[]
  etfMappings: EtfMapping[]
  alerts: PlanAlert[]
  /** 可选：场内外 K 线数据，用于 kline_enhanced 模板 */
  klineDataMap?: Record<string, KLineData[]>  // key = exchangeCode
}

function fmt(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`
}

function currency(v: number): string {
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
}

function holdingTable(selected: FundHolding[], quotes: FundQuote[]): string {
  const rows = selected.map((h) => {
    const q = quotes.find((q) => q.code === h.code)
    const nav = q?.nav || 0
    const costValue = h.costNAV && h.shares ? h.costNAV * h.shares : (h.holdingAmount ? h.holdingAmount - (h.holdingProfit ?? 0) : 0)
    const currentValue = h.holdingAmount || (h.costNAV && h.shares ? h.costNAV * h.shares : 0)
    const returnRate = costValue > 0 ? ((currentValue - costValue) / costValue) * 100 : 0

    return [
      h.code,
      h.name || '',
      MARKET_LABELS[h.market],
      TYPE_LABELS[h.type] || h.type,
      SECTOR_LABELS[h.sector] || h.sector,
      nav ? `¥${nav.toFixed(4)}` : '-',
      costValue ? currency(costValue) : '-',
      currentValue ? currency(currentValue) : '-',
      fmt(returnRate),
      q ? fmt(q.dailyChange) : '-',
    ].join(' | ')
  })

  const header = '代码 | 名称 | 市场 | 类型 | 领域 | 最新净值 | 投入成本 | 当前市值 | 收益率 | 今日涨跌幅'
  const sep = '--- | --- | --- | --- | --- | --- | --- | --- | --- | ---'
  return [header, sep, ...rows].join('\n')
}

function diagnosticPrompt(selected: FundHolding[], quotes: FundQuote[]): string {
  const totalCost = selected.reduce((s, h) => {
    return s + (h.costNAV && h.shares ? h.costNAV * h.shares : h.holdingAmount ? h.holdingAmount - (h.holdingProfit ?? 0) : 0)
  }, 0)
  const totalValue = selected.reduce((s, h) => {
    return s + (h.holdingAmount || (h.costNAV && h.shares ? h.costNAV * h.shares : 0))
  }, 0)
  const totalProfit = totalValue - totalCost
  const avgReturn = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0

  return `## 基金持仓诊断请求

请根据以下持仓信息，给出投资分析和建议。

### 持仓概览
- 持仓基金数：${selected.length} 只
- 总投入成本：${currency(totalCost)}
- 当前总市值：${currency(totalValue)}
- 总盈亏：${totalProfit >= 0 ? '+' : ''}${currency(totalProfit)}（${fmt(avgReturn)}）

### 持仓明细

${holdingTable(selected, quotes)}

### 分析要求

请从以下角度进行分析：
1. **持仓集中度**：分析行业/类型分布是否过于集中
2. **风险收益**：整体组合的风险收益特征
3. **调仓建议**：哪些基金需要重点关注（加仓/减仓/调换）
4. **后市展望**：结合当前市场环境给出建议

（注：场内 ETF 可通过 K 线技术面进行分析）
`
}

function rebalancePrompt(selected: FundHolding[], quotes: FundQuote[], alerts: PlanAlert[]): string {
  const pendingAlerts = alerts.filter((a) => !a.executed && !a.dismissed && selected.some((h) => h.code === a.fundCode))

  let alertSection = ''
  if (pendingAlerts.length > 0) {
    alertSection = `\n### 当前触发的投资计划提醒\n\n下列基金触发了投资规则，请评估是否执行：\n\n基金代码 | 基金名称 | 建议操作 | 触发原因\n--- | --- | --- | ---\n`
    alertSection += pendingAlerts.map((a) =>
      `${a.fundCode} | ${a.fundName} | ${a.action === 'buy' ? '买入' : '卖出'}${a.shares > 0 ? ` ${a.shares}份` : ''} | ${a.reason}`
    ).join('\n')
  }

  const table = holdingTable(selected, quotes)
  const totalCost = selected.reduce((s, h) => {
    return s + (h.costNAV && h.shares ? h.costNAV * h.shares : h.holdingAmount ? h.holdingAmount - (h.holdingProfit ?? 0) : 0)
  }, 0)
  const totalValue = selected.reduce((s, h) => {
    return s + (h.holdingAmount || (h.costNAV && h.shares ? h.costNAV * h.shares : 0))
  }, 0)

  return `## 基金调仓建议请求

请根据以下持仓数据和投资计划提醒，给出具体的调仓建议。

### 持仓概览
- 总投入：${currency(totalCost)}
- 总市值：${currency(totalValue)}
- 总盈亏：${currency(totalValue - totalCost)}（${totalCost > 0 ? fmt(((totalValue - totalCost) / totalCost) * 100) : '0.00%'}）

### 持仓明细

${table}
${alertSection}

### 调仓要求

1. 针对每条投资计划提醒，评估是否应该执行
2. 给出具体的调仓顺序和仓位调整比例
3. 考虑整体组合平衡性（行业、类型分散）
4. 列出需要保留/减持/清仓的基金及理由
`
}

function klineEnhancedPrompt(
  selected: FundHolding[],
  quotes: FundQuote[],
  etfMappings: EtfMapping[],
  klineDataMap?: Record<string, KLineData[]>,
): string {
  const table = holdingTable(selected, quotes)

  // Build ETF mapping section
  let etfSection = ''
  const mappedFunds = selected.filter((h) => etfMappings.some((m) => m.otcCode === h.code))
  if (mappedFunds.length > 0) {
    etfSection = '\n### 场外↔场内 ETF 映射\n\n'
    etfSection += '场外代码 | 场外名称 | 场内代码 | 场内名称\n--- | --- | --- | ---\n'
    for (const h of mappedFunds) {
      const m = etfMappings.find((m) => m.otcCode === h.code)
      if (m) {
        etfSection += `${m.otcCode} | ${m.otcName} | ${m.exchangeCode} | ${m.exchangeName}\n`
      }
    }

    // Add K-line pattern analysis when data is available
    let klineSection = ''
    for (const h of mappedFunds) {
      const m = etfMappings.find((em) => em.otcCode === h.code)
      if (!m) continue
      const kData = klineDataMap?.[m.exchangeCode]
      if (!kData || kData.length < 5) continue

      const patterns = detectPatterns(kData)
      const summary = formatPatternsSummary(patterns, kData)

      // Recent price range
      const latest = kData[kData.length - 1]
      const high = Math.max(...kData.map((d) => d.high)).toFixed(4)
      const low = Math.min(...kData.map((d) => d.low)).toFixed(4)

      klineSection += `\n#### ${m.exchangeName}（${m.exchangeCode}）— ${m.otcName}\n`
      klineSection += `- 最新收盘：¥${latest.close.toFixed(4)}（${latest.date}）\n`
      klineSection += `- ${kData.length}日范围：¥${low} ~ ¥${high}\n`
      klineSection += `- 成交量：${latest.volume || 'N/A'}\n`
      klineSection += `- 检测到的 K 线形态：\n${summary}\n`
    }

    if (klineSection) {
      etfSection += `\n### K 线形态分析（算法预检测）\n${klineSection}`
    }
  }

  return `## 基金 K 线增强分析请求

请结合以下持仓信息和可交易的场内 ETF，进行 K 线技术面分析。

### 持仓明细

${table}
${etfSection}

### 分析要求

1. **技术面分析**：对有对应场内 ETF 的基金，分析其 K 线形态（趋势/支撑/阻力/量能）
2. **入场时机**：结合技术指标给出当前是否适合买入/卖出的判断
3. **风险提示**：识别潜在的顶部/底部信号
4. **操作建议**：具体到每只基金的操作策略
`
}

/**
 * 生成 Prompt
 */
export function generatePrompt(options: GeneratePromptOptions): string {
  const { templateType, holdings, quotes, selectedIds, etfMappings, alerts, klineDataMap } = options

  const selected = holdings.filter((h) => selectedIds.includes(h.id))
  if (selected.length === 0) return ''

  let body = ''
  switch (templateType) {
    case 'diagnostic':
      body = diagnosticPrompt(selected, quotes)
      break
    case 'rebalance':
      body = rebalancePrompt(selected, quotes, alerts)
      break
    case 'kline_enhanced':
      body = klineEnhancedPrompt(selected, quotes, etfMappings, klineDataMap)
      break
  }

  return body
}

export function promptPreview(options: GeneratePromptOptions): string {
  return generatePrompt(options)
}
