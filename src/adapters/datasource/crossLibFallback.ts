/**
 * 极薄跨库兜底 helper（仅用于 3 个重叠接口：K线 / 股票行情 / 股票搜索）。
 *
 * 设计边界（与 stock-sdk-migration-plan.md §3 决策 4 一致）：
 * - **只做 try/catch 编排**，不重新实现 fetch / 重试 / 限流 / JSONP / 熔断；
 *   这些治理 100% 交给 stock-sdk 与 stock-api 各自的内部实现。
 * - 主源（stock-api）返回「无效结果」（异常 / 空数组 / 调用方判定为空）时，
 *   才回退到兜底库（stock-sdk）。基金域接口不套此 helper（stock-api 无基金数据）。
 */
export async function withCrossLibFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  label: string,
  isValid: (result: T) => boolean = (r) =>
    !Array.isArray(r) || (r as unknown as unknown[]).length > 0,
): Promise<T> {
  try {
    const result = await primary()
    if (isValid(result)) return result
    console.warn(`[crossLibFallback:${label}] 主源返回无效结果，回退 stock-sdk`)
  } catch (err) {
    console.warn(`[crossLibFallback:${label}] 主源失败，回退 stock-sdk:`, err)
  }
  return fallback()
}
