/**
 * 数据缓存工具
 * 缓存到 IndexedDB，避免频繁调用 API
 */

import { db } from '@/stores/db'
import type { KLineData } from '@/types'

interface CacheEntry<T = any> {
  id: string
  data: T
  cachedAt: number
}

// 默认缓存有效期
const DEFAULT_TTL = 60 * 60 * 1000 // 1 小时

// 各类缓存的 TTL（毫秒）
const TTL: Record<string, number> = {
  '1m': 15 * 60 * 1000,
  '3m': 60 * 60 * 1000,
  '6m': 2 * 60 * 60 * 1000,
  '1y': 4 * 60 * 60 * 1000,
}

/** 通用缓存：从 IndexedDB 读取 */
async function getCache<T>(id: string, ttl = DEFAULT_TTL): Promise<T | null> {
  try {
    const entry = await db.table('klineCache').get(id) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() - entry.cachedAt > ttl) {
      await db.table('klineCache').delete(id)
      return null
    }
    return entry.data
  } catch { return null }
}

/** 通用缓存：写入 IndexedDB */
async function setCache<T>(id: string, data: T): Promise<void> {
  if (data == null) return
  try {
    await db.table('klineCache').put({ id, data, cachedAt: Date.now() })
  } catch { /* non-critical */ }
}

// ── K 线缓存 ────────────────────────────────

export async function getKlineCache(code: string, period: string): Promise<KLineData[] | null> {
  return getCache<KLineData[]>(`k_${code}__${period}`, TTL[period] || DEFAULT_TTL)
}

export async function setKlineCache(code: string, period: string, data: KLineData[]): Promise<void> {
  return setCache(`k_${code}__${period}`, data)
}

// ── 基金持仓缓存 ────────────────────────────

export interface PortfolioCache {
  date: string
  holdings: { code: string; name: string; ratio: number; value: number }[]
}

export async function getPortfolioCache(fundCode: string): Promise<PortfolioCache | null> {
  return getCache<PortfolioCache>(`pf_${fundCode}`, 2 * 60 * 60 * 1000) // 2 小时
}

export async function setPortfolioCache(fundCode: string, data: PortfolioCache): Promise<void> {
  return setCache(`pf_${fundCode}`, data)
}

// ── 通用 ────────────────────────────────────

export async function clearAllCache(): Promise<void> {
  try { await db.table('klineCache').clear() } catch { /* ignore */ }
}
