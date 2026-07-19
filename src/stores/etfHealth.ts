import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 健康缓存有效期：7 天内同一 exchangeCode 若曾检测为健康，则跳过重复检测 */
export const ETF_HEALTH_TTL = 7 * 24 * 60 * 60 * 1000

interface EtfHealthCache {
  [exchangeCode: string]: { ok: boolean; checkedAt: number }
}

interface EtfHealthState {
  cache: EtfHealthCache
  set: (exchangeCode: string, ok: boolean) => void
  get: (exchangeCode: string) => { ok: boolean; checkedAt: number } | undefined
}

/**
 * ETF 映射「K 线取数健康」缓存。
 * 按 exchangeCode 记录最近一次检测结果，供「检测错误映射」跳过已确认健康的项（正常不重复检测）。
 */
export const useEtfHealthStore = create<EtfHealthState>()(
  persist(
    (set, get) => ({
      cache: {},
      set: (exchangeCode, ok) =>
        set((s) => ({
          cache: { ...s.cache, [exchangeCode]: { ok, checkedAt: Date.now() } },
        })),
      get: (exchangeCode) => get().cache[exchangeCode],
    }),
    { name: 'etf-health-cache' },
  ),
)
