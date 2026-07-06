import type { FundHolding } from '@/types'

/** 涨跌幅/盈亏的正负前缀（+ 表示非负，负数自动带 -） */
export function formatSigned(value: number): string {
  return value >= 0 ? '+' : ''
}

/** 带正负号 + 两位小数的百分比，如 +3.21% / -1.05% */
export function formatPercent(value: number): string {
  return `${formatSigned(value)}${value.toFixed(2)}%`
}

/**
 * A 股配色：涨=红，跌=绿（红涨绿跌）。
 * 接受数值（>=0 视为涨）或布尔（true 视为涨），统一返回 Tailwind 文本色类。
 */
export function pnlColor(value: number | boolean): string {
  const isUp = typeof value === 'boolean' ? value : value >= 0
  return isUp ? 'text-up' : 'text-down'
}

/** ¥ 金额格式化，保留两位小数 */
export function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * 持仓参考市值：
 * 方式一（成本净值+份额）：成本净值 × 份额
 * 方式二（持有金额）：直接取持有金额（已含收益）
 */
export function calcValue(h: FundHolding): number {
  if (h.costNAV && h.shares) return h.costNAV * h.shares
  if (h.holdingAmount) return h.holdingAmount
  return 0
}

/**
 * 持仓成本投入：
 * 方式一（成本净值+份额）：成本净值 × 份额
 * 方式二（持有金额）：持有金额 - 持有收益
 */
export function calcCost(h: FundHolding): number {
  if (h.costNAV && h.shares) return h.costNAV * h.shares
  if (h.holdingAmount && h.holdingProfit !== undefined) {
    return h.holdingAmount - h.holdingProfit
  }
  return 0
}

/** 持仓浮动盈亏 = 参考市值 - 成本投入 */
export function calcProfit(h: FundHolding): number {
  return calcValue(h) - calcCost(h)
}
