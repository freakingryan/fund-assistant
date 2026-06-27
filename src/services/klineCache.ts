/**
 * 数据缓存工具
 * 缓存到 IndexedDB，避免频繁调用 API
 *
 * 缓存过期策略（A股交易时间智能计算）：
 * - 上午盘 (9:30-10:30): 在 10:30 刷新（午盘收盘前 1 小时）
 * - 上午盘尾段 (10:30-11:30): 不自动过期，用户可手动刷新
 * - 午休 (11:30-13:00): 在 14:00 刷新（收盘前 1 小时）
 * - 下午盘 (13:00-14:00): 在 14:00 刷新
 * - 下午盘尾段 (14:00-15:00): 不自动过期，用户可手动刷新
 * - 非交易时间: 缓存到下一个交易日的 10:30
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

// 各类缓存的 TTL（毫秒）— 静态 TTL 用于 K 线周期
const TTL: Record<string, number> = {
  '1m': 15 * 60 * 1000,
  '3m': 60 * 60 * 1000,
  '6m': 2 * 60 * 60 * 1000,
  '1y': 4 * 60 * 60 * 1000,
}

/**
 * 判断当前时间是否为 A 股交易时间
 * 中国市场：周一至周五 9:30-11:30（上午），13:00-15:00（下午）
 */
function isTradingDay(): boolean {
  const now = new Date()
  const day = now.getDay()
  return day >= 1 && day <= 5 // 周一至周五
}

/**
 * 计算交易时段内的缓存过期时间（绝对时间戳）
 * 返回 -1 表示非交易时间（应使用长 TTL）
 */
function getNextExpiryTime(): number {
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()

  if (!isTradingDay()) {
    return -1 // 非交易日，使用长 TTL
  }

  // 上午盘 9:30-11:30
  if (minutes >= 9 * 60 + 30 && minutes < 10 * 60 + 30) {
    // 9:30 - 10:30：在 10:30 过期
    const expiry = new Date(now)
    expiry.setHours(10, 30, 0, 0)
    return expiry.getTime()
  }
  if (minutes >= 10 * 60 + 30 && minutes < 11 * 60 + 30) {
    // 10:30 - 11:30：盘尾段不自动过期，用户手动刷新
    return -1
  }

  // 午休 11:30-13:00
  if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) {
    // 在 14:00 过期（下午盘收盘前 1 小时）
    const expiry = new Date(now)
    expiry.setHours(14, 0, 0, 0)
    return expiry.getTime()
  }

  // 下午盘 13:00-14:00
  if (minutes >= 13 * 60 && minutes < 14 * 60) {
    // 在 14:00 过期
    const expiry = new Date(now)
    expiry.setHours(14, 0, 0, 0)
    return expiry.getTime()
  }

  // 下午盘 14:00-15:00：盘尾段不自动过期，用户手动刷新
  if (minutes >= 14 * 60 && minutes < 15 * 60) {
    return -1
  }

  return -1 // 非交易时间
}

/**
 * 获取基于 A 股交易时间的动态 TTL（毫秒）
 * 在交易时段内自动调整过期时间，非交易时段使用长 TTL
 */
export function getTradingSessionTTL(fallbackTTL = 24 * 60 * 60 * 1000): number {
  const expiry = getNextExpiryTime()
  if (expiry === -1) {
    return fallbackTTL // 非交易时段
  }
  const ttl = expiry - Date.now()
  return Math.max(ttl, 60 * 1000) // 最小 1 分钟
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

/** 获取缓存写入时间（毫秒时间戳），缓存不存在或过期则返回 null */
async function getCacheTime(id: string, ttl = DEFAULT_TTL): Promise<number | null> {
  try {
    const entry = await db.table('klineCache').get(id) as CacheEntry | undefined
    if (!entry) return null
    if (Date.now() - entry.cachedAt > ttl) return null  // 只返回 null，不删除（CQS 原则）
    return entry.cachedAt
  } catch { return null }
}

/** 格式化缓存时间为 HH:MM 字符串 */
export function formatCacheTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 删除指定 ID 的缓存 */
async function deleteCache(id: string): Promise<void> {
  try {
    await db.table('klineCache').delete(id)
  } catch { /* non-critical */ }
}

/** 按前缀批量删除缓存 */
async function deleteCacheByPrefix(prefix: string): Promise<void> {
  try {
    const table = db.table('klineCache')
    const keys = await table.where('id').startsWith(prefix).primaryKeys()
    await table.bulkDelete(keys as string[])
  } catch { /* non-critical */ }
}

// ── K 线缓存 ────────────────────────────────

/** 数据版本号，变更时强制刷新缓存（数据源排序改变等场景） */
const KLINE_CACHE_VERSION = 'v2'

export async function getKlineCache(code: string, period: string): Promise<KLineData[] | null> {
  return getCache<KLineData[]>(`k_${KLINE_CACHE_VERSION}_${code}__${period}`, TTL[period] || DEFAULT_TTL)
}

export async function setKlineCache(code: string, period: string, data: KLineData[]): Promise<void> {
  return setCache(`k_${KLINE_CACHE_VERSION}_${code}__${period}`, data)
}

export async function deleteKlineCache(code: string, period: string): Promise<void> {
  return deleteCache(`k_${KLINE_CACHE_VERSION}_${code}__${period}`)
}

export async function deleteAllKlineCache(): Promise<void> {
  return deleteCacheByPrefix('k_v2_')
}

export async function getKlineCacheTime(code: string, period: string): Promise<number | null> {
  return getCacheTime(`k_${code}__${period}`, TTL[period] || DEFAULT_TTL)
}


// ── 基金持仓缓存 ────────────────────────────

export interface PortfolioCache {
  date: string
  holdings: { code: string; name: string; ratio: number; value: number }[]
}

const PORTFOLIO_TTL = 2 * 60 * 60 * 1000 // 2 小时

export async function getPortfolioCache(fundCode: string): Promise<PortfolioCache | null> {
  return getCache<PortfolioCache>(`pf_${fundCode}`, PORTFOLIO_TTL)
}

export async function setPortfolioCache(fundCode: string, data: PortfolioCache): Promise<void> {
  return setCache(`pf_${fundCode}`, data)
}

export async function deletePortfolioCache(fundCode: string): Promise<void> {
  return deleteCache(`pf_${fundCode}`)
}

export async function getPortfolioCacheTime(fundCode: string): Promise<number | null> {
  return getCacheTime(`pf_${fundCode}`, PORTFOLIO_TTL)
}

// ── 基金排行缓存 ────────────────────────────

const RANK_TTL = 24 * 60 * 60 * 1000 // 1 天

export async function getRankCache(symbol: string): Promise<any[] | null> {
  return getCache<any[]>(`rk_${symbol}`, RANK_TTL)
}

export async function setRankCache(symbol: string, data: any[]): Promise<void> {
  return setCache(`rk_${symbol}`, data)
}

export async function deleteRankCache(symbol: string): Promise<void> {
  return deleteCache(`rk_${symbol}`)
}

export async function getRankCacheTime(symbol: string): Promise<number | null> {
  return getCacheTime(`rk_${symbol}`, RANK_TTL)
}

// ── 实时净值缓存 ────────────────────────────
// 使用 A 股交易时间智能过期

export interface QuotesCache {
  quotes: { code: string; nav: number; dailyChange: number; navDate?: string }[]
}

export async function getQuotesCache(codes: string[]): Promise<QuotesCache | null> {
  const sorted = [...codes].sort().join(',')
  return getCache<QuotesCache>(`q_${sorted}`, getTradingSessionTTL())
}

export async function setQuotesCache(codes: string[], quotes: QuotesCache['quotes']): Promise<void> {
  const sorted = [...codes].sort().join(',')
  return setCache(`q_${sorted}`, { quotes })
}

export async function deleteQuotesCache(): Promise<void> {
  return deleteCacheByPrefix('q_')
}

export async function getQuotesCacheTime(codes: string[]): Promise<number | null> {
  const sorted = [...codes].sort().join(',')
  return getCacheTime(`q_${sorted}`, getTradingSessionTTL())
}

// ── 基金基本信息缓存 ────────────────────────
// 基金名称、类型、领域等几乎不变，24h TTL

export interface FundInfoCache {
  code: string
  name: string
  type: string
  sector: string
  description: string
}

export async function getFundInfoCache(code: string): Promise<FundInfoCache | null> {
  return getCache<FundInfoCache>(`fi_${code}`, 24 * 60 * 60 * 1000)
}

export async function setFundInfoCache(code: string, info: FundInfoCache): Promise<void> {
  return setCache(`fi_${code}`, info)
}

export async function deleteFundInfoCache(code: string): Promise<void> {
  return deleteCache(`fi_${code}`)
}

// ── ETF 映射缓存 ────────────────────────────
// 场外→场内 ETF 映射关系几乎不变，7 天 TTL

export interface EtfMappingCache {
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
}

const ETF_MAPPING_TTL = 7 * 24 * 60 * 60 * 1000 // 7 天

export async function getEtfMappingCache(otcCode: string): Promise<EtfMappingCache | null> {
  return getCache<EtfMappingCache>(`em_${otcCode}`, ETF_MAPPING_TTL)
}

export async function setEtfMappingCache(code: string, mapping: EtfMappingCache): Promise<void> {
  return setCache(`em_${code}`, mapping)
}

export async function deleteEtfMappingCache(otcCode: string): Promise<void> {
  return deleteCache(`em_${otcCode}`)
}

// ── 通用 ────────────────────────────────────

export async function clearAllCache(): Promise<void> {
  try { await db.table('klineCache').clear() } catch { /* ignore */ }
}
