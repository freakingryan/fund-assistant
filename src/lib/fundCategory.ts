/**
 * 基金「场内 ETF 类」分类
 *
 * 规则：基金名称含 `etf` / `ETF` / `指数` 即归为「场内 ETF 类」——
 * 此类基金（含 ETF 联接、指数增强、指数型等）通常都有对应的场内交易 ETF，
 * 可切换到「场内 ETF 真实 K 线」查看基于真实 OHLC 的形态 / 指标分析。
 *
 * 该判断被以下位置复用，保持唯一真相来源：
 *  - settings 的 ETF 映射管理（区分主动型 / 被动指数型，控制批量补全范围）
 *  - 基金详情页（此类基金默认优先展示场内 ETF 真实 K 线）
 *
 * 注意：大小写不敏感（etf / ETF 均匹配），以覆盖名称写法差异。
 */
export const ON_EXCHANGE_ETF_NAME = /etf|指数/i

/** 判断基金是否属于「场内 ETF 类」（有对应场内 ETF，可展示真实 K 线） */
export function isOnExchangeEtfFund(name: string | undefined): boolean {
  return ON_EXCHANGE_ETF_NAME.test(name || '')
}
