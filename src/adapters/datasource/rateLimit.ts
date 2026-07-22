/**
 * 频率节流（Rate Limit）—— 调用层防护之二
 *
 * 设计动机：
 *  - 即便单点请求没问题，批量扫描（reconcileSnapshots 遍历全部快照、
 *    plans.scan 遍历全部持仓）仍会在瞬间对同一上游发起大量顺序请求。
 *    很多行情接口对单 IP 有频控（每秒若干次），瞬间猛捶可能被限流/封禁。
 *  - 本工具按「端点类别」维度串行化：同一类别的相邻请求严格排队，
 *    且至少间隔 minIntervalMs，把「瞬时爆发」摊平成「匀速脉冲」。
 *
 * 关键性质：
 *  - 按端点类别共享一条串行链（如 'tencent-kline' 下所有 ETF 共用），
 *    与 circuitBreaker 的维度一致。
 *  - 单点请求（用户手动刷新详情页）走同一链条，仅多付出 minIntervalMs 的微小延迟，
 *    不影响可用性。
 *  - 单个请求失败也推进链条（rejection 被吞），不会阻塞后续请求。
 */

const chains = new Map<string, Promise<unknown>>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 按端点类别串行 + 最小间隔地执行 factory。
 * @param key           端点类别键（与 circuitBreaker 共用）
 * @param minIntervalMs 相邻请求的最小间隔（毫秒）
 * @param factory       真实请求工厂
 */
export async function withThrottle<T>(
  key: string,
  minIntervalMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  // 先等上一个请求跑完，再 sleep 间隔，最后发起本次请求 → 严格串行 + 间隔
  const result = prev.then(() => sleep(minIntervalMs)).then(() => factory())
  // 存一条「吞掉 rejection」的链，保证前一个失败不会让后续请求卡住
  chains.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}
