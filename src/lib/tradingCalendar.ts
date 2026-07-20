/**
 * A 股交易日历（本地判定，零网络依赖）。
 *
 * 判定某天是否为交易日：周一~周五 且 不在法定休市区间内。
 * 数据来源：沪深北交易所《2026 年部分节假日休市安排》（证监办发〔2025〕130 号）。
 *
 * ⚠️ 维护提醒：交易所每年底发布下一年度休市安排，本表需逐年更新。
 *    结构按年份分桶，新增年份只需在 MARKET_HOLIDAYS_BY_YEAR 加一项即可。
 */

export type DateRange = readonly [start: string, end: string]

/** 各年份法定休市区间（含周末内的休市日，调用方通常用 isWeekend 预过滤） */
export const MARKET_HOLIDAYS_BY_YEAR: Record<number, DateRange[]> = {
  2026: [
    ['2026-01-01', '2026-01-03'], // 元旦
    ['2026-02-15', '2026-02-23'], // 春节
    ['2026-04-04', '2026-04-06'], // 清明节
    ['2026-05-01', '2026-05-05'], // 劳动节
    ['2026-06-19', '2026-06-21'], // 端午节
    ['2026-09-25', '2026-09-27'], // 中秋节
    ['2026-10-01', '2026-10-07'], // 国庆节
  ],
  // 2027: 待交易所发布后补充
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isWeekend(d: Date): boolean {
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

/** 是否为 A 股法定休市日（命中任一年度休市区间） */
export function isMarketHoliday(d: Date): boolean {
  const key = dateKey(d)
  const ranges = MARKET_HOLIDAYS_BY_YEAR[d.getFullYear()]
  if (!ranges) return false
  return ranges.some(([s, e]) => key >= s && key <= e)
}

/** 是否为 A 股交易日：周一~周五 且 非法定休市日 */
export function isTradingDay(d: Date): boolean {
  if (isWeekend(d)) return false
  return !isMarketHoliday(d)
}
