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
  importHoldings: (holdings: Omit<FundHolding, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<void>
}

export const useHoldingsStore = create<HoldingsState>((set, get) => ({
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
    const records: FundHolding[] = holdings.map((h) => ({
      ...h,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))
    await db.holdings.bulkAdd(records)
    set((s) => ({ holdings: [...s.holdings, ...records] }))
  },
}))
