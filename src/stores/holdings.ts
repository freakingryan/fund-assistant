import { create } from 'zustand'
import { db } from './db'
import type { FundHolding, FundQuote } from '@/types'

interface HoldingsState {
  holdings: FundHolding[]
  quotes: Record<string, FundQuote>
  selectedIds: string[]
  loading: boolean
  error: string | null

  loadHoldings: () => Promise<void>
  addHolding: (holding: Omit<FundHolding, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateHolding: (id: string, data: Partial<FundHolding>) => Promise<void>
  removeHolding: (id: string) => Promise<void>
  removeHoldings: (ids: string[]) => Promise<void>
  setSelected: (ids: string[]) => void
  toggleSelected: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  updateQuotes: (quotes: FundQuote[]) => void
  importHoldings: (holdings: Omit<FundHolding, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<{ added: number; updated: number }>
}

export const useHoldingsStore = create<HoldingsState>((set, _get) => ({
  holdings: [],
  quotes: {},
  selectedIds: [],
  loading: false,
  error: null,

  loadHoldings: async () => {
    set({ loading: true })
    try {
      const holdings = await db.holdings.toArray()
      set({ holdings, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  addHolding: async (data) => {
    const now = new Date().toISOString()
    const holding: FundHolding = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    await db.holdings.add(holding)
    set((s) => ({ holdings: [...s.holdings, holding] }))
  },

  updateHolding: async (id, data) => {
    await db.holdings.update(id, { ...data, updatedAt: new Date().toISOString() })
    set((s) => ({
      holdings: s.holdings.map((h) => (h.id === id ? { ...h, ...data } : h)),
    }))
  },

  removeHolding: async (id) => {
    await db.holdings.delete(id)
    set((s) => ({
      holdings: s.holdings.filter((h) => h.id !== id),
      selectedIds: s.selectedIds.filter((sid) => sid !== id),
    }))
  },

  removeHoldings: async (ids) => {
    await db.holdings.bulkDelete(ids)
    set((s) => ({
      holdings: s.holdings.filter((h) => !ids.includes(h.id)),
      selectedIds: s.selectedIds.filter((sid) => !ids.includes(sid)),
    }))
  },

  setSelected: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((sid) => sid !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: () => set((s) => ({ selectedIds: s.holdings.map((h) => h.id) })),
  clearSelection: () => set({ selectedIds: [] }),

  updateQuotes: (quotes) =>
    set((s) => {
      const newQuotes = { ...s.quotes }
      for (const q of quotes) {
        newQuotes[q.code] = q
      }
      return { quotes: newQuotes }
    }),

  importHoldings: async (holdings) => {
    const now = new Date().toISOString()
    let added = 0
    let updated = 0
    const newRecords: FundHolding[] = []
    const updatedChanges: { id: string; changes: Partial<FundHolding> }[] = []

    for (const h of holdings) {
      // 空 code（截图未识别 / 待用户补全）无法匹配，始终作为新记录新增
      if (!h.code) {
        newRecords.push({ ...h, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
        added++
        continue
      }
      const existing = await db.holdings.where('code').equals(h.code).first()
      if (existing) {
        // 合并策略：刷新来源字段，保留用户维护字段（tags / notes / purchaseDate / id / createdAt），
        // 且仅当导入提供了有效份额/成本时才覆盖，避免截图导入（份额=0）清零手动录入的真实持仓数据。
        const changes: Partial<FundHolding> = {
          name: h.name || existing.name,
          market: h.market,
          type: h.type,
          sector: h.sector,
          holdingAmount: h.holdingAmount || existing.holdingAmount,
          holdingProfit: h.holdingProfit || existing.holdingProfit,
          costNAV: h.costNAV > 0 ? h.costNAV : existing.costNAV,
          shares: h.shares > 0 ? h.shares : existing.shares,
          updatedAt: now,
        }
        updatedChanges.push({ id: existing.id, changes })
        updated++
      } else {
        newRecords.push({ ...h, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
        added++
      }
    }

    if (newRecords.length) await db.holdings.bulkAdd(newRecords)
    for (const u of updatedChanges) {
      await db.holdings.update(u.id, u.changes)
    }

    // 重新读取全量，保证 store 与 DB 一致（新增 + 更新混合）
    const all = await db.holdings.toArray()
    set(() => ({ holdings: all }))
    return { added, updated }
  },
}))
