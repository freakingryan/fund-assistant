/**
 * 请求级「在途去重」（in-flight deduplication）
 *
 * 问题背景：klineCache 只缓存「已完成的落盘结果」（IndexedDB）。当缓存未命中时，
 * 多个并发调用方（多个 useRealtimeQuotes 实例、Dashboard 直接 fetch、批量扫描
 * plans/decisionSnapshot、React StrictMode 双挂载等）会对同一 code/period 或同一
 * codes 集合各自发起真实网络请求，造成「短时间多次调用同一接口」。
 *
 * 本工具只合并「同一时刻、同一 key 的在途请求」：
 * - 同一 key 的请求正在进行中时，后续相同 key 复用同一个 Promise，不再发重复请求；
 * - 请求完成后立即从 pending 移除（不缓存结果），因此不会缓存失败/空响应，
 *   也不会影响调用方的 force 刷新语义（刷新仍会重新请求）。
 */
const pending = new Map<string, Promise<unknown>>()

export function dedupRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const p = factory().finally(() => {
    // 仅当仍是当前 Promise 时才删除，避免误删后续新请求
    if (pending.get(key) === p) pending.delete(key)
  })
  pending.set(key, p)
  return p
}
