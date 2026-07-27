/**
 * Promise 工具函数
 */

/**
 * 给 Promise 加超时兜底。超时或异常都返回 `fallback` 而不是抛错，
 * 适合「网络可能挂起，但绝不能一直 loading」的场景。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  reason = "timeout",
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[withTimeout] ${reason} after ${ms}ms, returning fallback`);
      resolve(fallback);
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
