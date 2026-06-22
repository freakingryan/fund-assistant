/**
 * K 线数据缓存工具
 * 缓存到 IndexedDB，避免频繁调用 API
 */

import { db } from '@/stores/db'
import type { KLineData } from '@/types'

interface KlineCacheEntry {
  id: string        // `${code}__${period}` — 复合键
  code: string
  period: string
  data: KLineData[]
  cachedAt: number  // Date.now() 缓存时间戳
}

// 缓存有效期（毫秒）
const TTL: Record<string, number> = {
  '1m': 15 * 60 * 1000,    // 1月周期：15 分钟（日数据）
  '3m': 60 * 60 * 1000,    // 3月周期：1 小时
  '6m': 2 * 60 * 60 * 1000, // 6月周期：2 小时
  '1y': 4 * 60 * 60 * 1000, // 1年周期：4 小时
}

/**
 * 从缓存读取 K 线数据
 */
export async function getKlineCache(code: string, period: string): Promise<KLineData[] | null> {
  try {
    const id = `${code}__${period}`
    const entry = await db.table('klineCache').get(id) as KlineCacheEntry | undefined
    if (!entry) return null

    const ttl = TTL[period] || 60 * 60 * 1000 // 默认 1 小时
    if (Date.now() - entry.cachedAt > ttl) {
      // 过期了，删除并返回 null
      await db.table('klineCache').delete(id)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

/**
 * 写入 K 线缓存
 */
export async function setKlineCache(code: string, period: string, data: KLineData[]): Promise<void> {
  if (!data || data.length === 0) return
  try {
    await db.table('klineCache').put({
      id: `${code}__${period}`,
      code,
      period,
      data,
      cachedAt: Date.now(),
    } as KlineCacheEntry)
  } catch { /* cache write failure is non-critical */ }
}

/**
 * 清除所有 K 线缓存（用于手动刷新）
 */
export async function clearKlineCache(): Promise<void> {
  try {
    await db.table('klineCache').clear()
  } catch { /* ignore */ }
}
