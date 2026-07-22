/**
 * 失败熔断（Circuit Breaker）—— 调用层防护之一
 *
 * 设计动机：
 *  - 上游端点（腾讯 K 线、东财净值、腾讯报价等）可能因 WAF 拦截、限流、
 *    网络抖动而整段失效。若不做防护，批量扫描（reconcileSnapshots / plans.scan）
 *    会对同一失效端点瞬间猛捶，导致控制台刷屏、甚至触发上游 IP 封禁。
 *  - 熔断把「失败」收敛为「短路」：连续失败达到阈值后，在 OPEN 窗口内直接抛错，
 *    不再发起任何真实请求；窗口结束后进入半开（half-open）试探一次，
 *    成功则复位，失败则重新开路。
 *
 * 关键性质：
 *  - 按「端点类别」维度熔断（如 'tencent-kline'），而非按 code。同一上游所有
 *    code 共享一个熔断状态，符合「一个端点挂了就该全体停手」的直觉。
 *  - 不缓存成功结果，只记录失败计数；不影响调用方的 force 刷新语义。
 *  - 熔断抛出的 CircuitOpenError 由上层（service.guarded）捕获并降级为空结果，
 *    绝不冒泡导致页面崩溃。
 */

export type BreakerStateName = 'closed' | 'open' | 'half-open'

interface BreakerState {
  failures: number
  state: BreakerStateName
  /** OPEN 状态结束、允许 half-open 试探的时间戳（ms） */
  nextTryAt: number
}

const DEFAULT_THRESHOLD = 3
const DEFAULT_OPEN_MS = 30_000

const breakers = new Map<string, BreakerState>()

export class CircuitOpenError extends Error {
  constructor(
    public readonly endpointKey: string,
    retryAfterMs: number,
  ) {
    super(
      `[circuit-breaker] 端点 ${endpointKey} 熔断中，约 ${Math.ceil(
        retryAfterMs / 1000,
      )}s 后重试`,
    )
    this.name = 'CircuitOpenError'
  }
}

/**
 * 用熔断包裹一次真实请求。
 * @param key       端点类别键（建议全大写连字符，如 'tencent-kline'）
 * @param factory   真实请求工厂（会发网络请求）
 * @param opts.threshold  连续失败几次后开路（默认 3）
 * @param opts.openMs     开路持续时间（默认 30s）
 */
export async function callWithBreaker<T>(
  key: string,
  factory: () => Promise<T>,
  opts?: { threshold?: number; openMs?: number },
): Promise<T> {
  const now = Date.now()
  let b = breakers.get(key)
  if (!b) {
    b = { failures: 0, state: 'closed', nextTryAt: 0 }
    breakers.set(key, b)
  }

  // OPEN 且未到试探时间 → 直接短路，零网络请求
  if (b.state === 'open') {
    if (now >= b.nextTryAt) {
      b.state = 'half-open'
      b.failures = 0
    } else {
      throw new CircuitOpenError(key, b.nextTryAt - now)
    }
  }

  try {
    const res = await factory()
    // 任何成功都复位（含 half-open 试探成功）
    b.state = 'closed'
    b.failures = 0
    return res
  } catch (e) {
    b.failures += 1
    const threshold = opts?.threshold ?? DEFAULT_THRESHOLD
    const openMs = opts?.openMs ?? DEFAULT_OPEN_MS
    if (b.state === 'half-open' || b.failures >= threshold) {
      const wasClosed = b.state === 'closed'
      b.state = 'open'
      b.nextTryAt = now + openMs
      if (wasClosed) {
        console.warn(
          `[circuit-breaker] 端点 ${key} 连续失败 ${b.failures} 次，熔断 ${Math.round(
            openMs / 1000,
          )}s（期间不再请求）`,
        )
      }
    }
    throw e
  }
}

/** 读取某端点的熔断状态（诊断/健康检查用） */
export function getBreakerState(
  key: string,
): { state: BreakerStateName; failures: number; nextTryAt: number } | null {
  const b = breakers.get(key)
  if (!b) return null
  return { state: b.state, failures: b.failures, nextTryAt: b.nextTryAt }
}

/** 手动复位某端点（诊断/测试用） */
export function resetBreaker(key: string): void {
  breakers.delete(key)
}
