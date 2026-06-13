import { create } from 'zustand'
import { db } from './db'
import type { InvestmentPlan, PlanLog, PlanRule } from '@/types'

interface PlansState {
  plans: InvestmentPlan[]
  logs: PlanLog[]
  loading: boolean
  error: string | null

  loadPlans: () => Promise<void>
  addPlan: (plan: Omit<InvestmentPlan, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updatePlan: (id: string, data: Partial<InvestmentPlan>) => Promise<void>
  removePlan: (id: string) => Promise<void>
  addRule: (planId: string, rule: Omit<PlanRule, 'id'>) => Promise<void>
  updateRule: (planId: string, ruleId: string, data: Partial<PlanRule>) => Promise<void>
  removeRule: (planId: string, ruleId: string) => Promise<void>
  togglePlanEnabled: (id: string) => Promise<void>
  addLog: (log: Omit<PlanLog, 'id'>) => Promise<void>
  markLogExecuted: (logId: string) => Promise<void>
  loadLogs: () => Promise<void>
}

export const usePlansStore = create<PlansState>((set) => ({
  plans: [],
  logs: [],
  loading: false,
  error: null,

  loadPlans: async () => {
    set({ loading: true })
    try {
      const plans = await db.plans.toArray()
      set({ plans, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  addPlan: async (data) => {
    const now = new Date().toISOString()
    const plan: InvestmentPlan = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    await db.plans.add(plan)
    set((s) => ({ plans: [...s.plans, plan] }))
  },

  updatePlan: async (id, data) => {
    await db.plans.update(id, { ...data, updatedAt: new Date().toISOString() })
    set((s) => ({
      plans: s.plans.map((p) => (p.id === id ? { ...p, ...data } : p)),
    }))
  },

  removePlan: async (id) => {
    await db.plans.delete(id)
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }))
  },

  addRule: async (planId, rule) => {
    const newRule: PlanRule = { ...rule, id: crypto.randomUUID() }
    const plan = (await db.plans.get(planId))!
    const updatedPlan = { ...plan, rules: [...plan.rules, newRule], updatedAt: new Date().toISOString() }
    await db.plans.update(planId, updatedPlan)
    set((s) => ({
      plans: s.plans.map((p) => (p.id === planId ? updatedPlan : p)),
    }))
  },

  updateRule: async (planId, ruleId, data) => {
    const plan = (await db.plans.get(planId))!
    const updatedPlan = {
      ...plan,
      rules: plan.rules.map((r) => (r.id === ruleId ? { ...r, ...data } : r)),
      updatedAt: new Date().toISOString(),
    }
    await db.plans.update(planId, updatedPlan)
    set((s) => ({
      plans: s.plans.map((p) => (p.id === planId ? updatedPlan : p)),
    }))
  },

  removeRule: async (planId, ruleId) => {
    const plan = (await db.plans.get(planId))!
    const updatedPlan = {
      ...plan,
      rules: plan.rules.filter((r) => r.id !== ruleId),
      updatedAt: new Date().toISOString(),
    }
    await db.plans.update(planId, updatedPlan)
    set((s) => ({
      plans: s.plans.map((p) => (p.id === planId ? updatedPlan : p)),
    }))
  },

  togglePlanEnabled: async (id) => {
    const plan = (await db.plans.get(id))!
    await db.plans.update(id, { enabled: !plan.enabled, updatedAt: new Date().toISOString() })
    set((s) => ({
      plans: s.plans.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    }))
  },

  addLog: async (log) => {
    const newLog: PlanLog = { ...log, id: crypto.randomUUID() }
    await db.planLogs.add(newLog)
    set((s) => ({ logs: [...s.logs, newLog] }))
  },

  markLogExecuted: async (logId) => {
    const now = new Date().toISOString()
    await db.planLogs.update(logId, { executed: true, executedAt: now })
    set((s) => ({
      logs: s.logs.map((l) => (l.id === logId ? { ...l, executed: true, executedAt: now } : l)),
    }))
  },

  loadLogs: async () => {
    const logs = await db.planLogs.orderBy('triggeredAt').reverse().toArray()
    set({ logs })
  },
}))
