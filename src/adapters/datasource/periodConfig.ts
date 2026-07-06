/**
 * K 线周期 → 交易日数量 的单一真相来源
 *
 * 之前 stock-api / tushare 两个适配器各自内联了一份不一致的映射
 * （1m: 30 vs 22、6m: 130 vs 132），导致同一基金切换数据源会拉到
 * 不同长度的 K 线，使形态/评分结果漂移。统一收敛到此文件。
 *
 * 取值采用标准交易日近似：1 月≈22、3 月≈66、6 月≈132、1 年≈250。
 */
export const MS_PER_DAY = 86_400_000

export const PERIOD_TRADING_DAYS: Record<string, number> = {
  '1m': 22,
  '3m': 66,
  '6m': 132,
  '1y': 250,
}

/** 将周期字符串解析为交易日数量，未匹配时回退到 3 月(66) */
export function periodToCount(period: string): number {
  return PERIOD_TRADING_DAYS[period] ?? 66
}
