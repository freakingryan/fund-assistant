import { create } from 'zustand'
import { db } from './db'
import type { InvestmentPlan, PlanRule, PlanAlert, PlanRuleType, Comparator, FundHolding } from '@/types'
import { dataSourceService } from '@/adapters/datasource/service'

const DEFAULT_PLAN: Omit<InvestmentPlan, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '全局投资计划',
  description: '所有持仓基金共用此套规则',
  rules: [
    {
      id: crypto.randomUUID(),
      type: 'return',
      threshold: -10,
      comparator: 'lte',
      action: 'buy',
      shares: 1,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'return',
      threshold: 15,
      comparator: 'gte',
      action: 'sell',
      shares: 2,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'daily_change',
      threshold: 3,
      comparator: 'lte',
      action: 'buy',
      shares: 0,
      enabled: true,
    },
  ],
  enabled: true,
}

interface PlansState {
  plan: InvestmentPlan | null
  alerts: PlanAlert[]
  loading: boolean
  scanning: boolean
  error: string | null

  loadPlan: () => Promise<void>
  updatePlan: (data: Partial<Omit<InvestmentPlan, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<void>
  addRule: (rule: Omit<PlanRule, 'id'>) => Promise<void>
  updateRule: (ruleId: string, data: Partial<PlanRule>) => Promise<void>
  removeRule: (ruleId: string) => Promise<void>
  togglePlanEnabled: () => Promise<void>

  /** 手动扫描：检查所有持仓是否符合规则 */
  scan: (holdings: FundHolding[]) => Promise<PlanAlert[]>

  loadAlerts: () => Promise<void>
  markAlertExecuted: (alertId: string) => Promise<void>
  dismissAlert: (alertId: string) => Promise<void>
}

export const usePlansStore = create<PlansState>((set, get) => ({
  plan: null,
  alerts: [],
  loading: false,
  scanning: false,
  error: null,

  loadPlan: async () => {
    set({ loading: true })
    try {
      let plan = await db.plans.get('global-plan')
      if (!plan) {
        const now = new Date().toISOString()
        plan = { ...DEFAULT_PLAN, id: 'global-plan', createdAt: now, updatedAt: now }
        await db.plans.add(plan)
      }
      set({ plan, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  updatePlan: async (data) => {
    const now = new Date().toISOString()
    const plan = get().plan!
    const updated = { ...plan, ...data, updatedAt: now }
    await db.plans.put(updated)
    set({ plan: updated })
  },

  addRule: async (rule) => {
    const newRule: PlanRule = { ...rule, id: crypto.randomUUID() }
    const plan = get().plan!
    const updated = { ...plan, rules: [...plan.rules, newRule], updatedAt: new Date().toISOString() }
    await db.plans.put(updated)
    set({ plan: updated })
  },

  updateRule: async (ruleId, data) => {
    const plan = get().plan!
    const updated = {
      ...plan,
      rules: plan.rules.map((r) => (r.id === ruleId ? { ...r, ...data } : r)),
      updatedAt: new Date().toISOString(),
    }
    await db.plans.put(updated)
    set({ plan: updated })
  },

  removeRule: async (ruleId) => {
    const plan = get().plan!
    const updated = {
      ...plan,
      rules: plan.rules.filter((r) => r.id !== ruleId),
      updatedAt: new Date().toISOString(),
    }
    await db.plans.put(updated)
    set({ plan: updated })
  },

  togglePlanEnabled: async () => {
    const plan = get().plan!
    const updated = { ...plan, enabled: !plan.enabled, updatedAt: new Date().toISOString() }
    await db.plans.put(updated)
    set({ plan: updated })
  },

  scan: async (holdings) => {
    set({ scanning: true })
    const plan = get().plan
    if (!plan || !plan.enabled) {
      set({ scanning: false })
      return []
    }

    const enabledRules = plan.rules.filter((r) => r.enabled)
    if (enabledRules.length === 0) {
      set({ scanning: false })
      return []
    }

    const codes = holdings.map((h) => h.code)
    const quotes = await dataSourceService.fetchQuotes(codes)
    const quoteMap = new Map(quotes.map((q) => [q.code, q]))

    const alerts: PlanAlert[] = []
    const now = new Date().toISOString()

    // C3 fix: 加载已有未处理的提醒用于去重
    const existingAlerts = await db.alerts
      .filter((a) => !a.executed && !a.dismissed)
      .toArray()
    const existingKeys = new Set(existingAlerts.map((a) => `${a.fundCode}|${a.ruleId}`))

    for (const h of holdings) {
      const q = quoteMap.get(h.code)
      if (!q) continue

      const nav = q.nav
      const costValue = h.costNAV && h.shares ? h.costNAV * h.shares : (h.holdingAmount && h.holdingProfit !== undefined ? h.holdingAmount - h.holdingProfit : 0)
      const costNAV = h.shares && h.costNAV ? h.costNAV : (costValue && h.shares ? costValue / h.shares : 0)

      // 当前收益率
      const returnRate = costNAV > 0 ? ((nav - costNAV) / costNAV) * 100 : 0

      for (const rule of enabledRules) {
        // C3 fix: 跳过已有未处理的相同 fundCode+ruleId
        if (existingKeys.has(`${h.code}|${rule.id}`)) continue

        let triggered = false
        let reason = ''

        switch (rule.type) {
          case 'return': {
            const matches = compare(returnRate, rule.comparator, rule.threshold)
            if (matches) {
              triggered = true
              reason = `收益率 ${returnRate >= 0 ? '+' : ''}${returnRate.toFixed(2)}% ${cmpLabel(rule.comparator)} ${rule.threshold}%`
            }
            break
          }
          case 'price_diff': {
            const diff = nav - costNAV
            const matches = compare(diff, rule.comparator, rule.threshold)
            if (matches) {
              triggered = true
              reason = `净值价差 ¥${diff.toFixed(4)} ${cmpLabel(rule.comparator)} ¥${rule.threshold}`
            }
            break
          }
          case 'daily_change': {
            const matches = compare(q.dailyChange, rule.comparator, rule.threshold)
            if (matches) {
              triggered = true
              reason = `今日涨跌幅 ${q.dailyChange >= 0 ? '+' : ''}${q.dailyChange.toFixed(2)}% ${cmpLabel(rule.comparator)} ${rule.threshold}%`
            }
            break
          }
          case 'dca': {
            // I3 fix: 检查最后提醒日期，超过间隔天数则触发
            const lastAlert = await db.alerts
              .filter((a) => a.fundCode === h.code && a.ruleType === 'dca')
              .reverse()
              .first()
            if (!lastAlert) {
              triggered = true
              reason = `定期定投提醒：已过 ${rule.threshold} 天未定投`
            } else {
              const daysSince = (Date.now() - new Date(lastAlert.triggeredAt).getTime()) / 86400000
              if (daysSince >= rule.threshold) {
                triggered = true
                reason = `定期定投提醒：距上次 ${Math.round(daysSince)} 天`
              }
            }
            break
          }
          case 'kline_pattern': {
            // I3 fix: 标记为手动类型，提示用户
            reason = `K 线形态诊断（手动触发）`
            // 不自动触发，需要用户手动点击 AI 诊断
            break
          }
        }

        if (triggered) {
          const alert: PlanAlert = {
            id: crypto.randomUUID(),
            fundCode: h.code,
            fundName: h.name || h.code,
            ruleId: rule.id,
            ruleType: rule.type,
            action: rule.action,
            shares: rule.shares,
            currentNAV: nav,
            costNAV: costNAV,
            returnRate,
            dailyChange: q.dailyChange,
            reason,
            triggeredAt: now,
            executed: false,
            dismissed: false,
          }
          alerts.push(alert)
        }
      }
    }

    // 保存到 DB
    if (alerts.length > 0) {
      await db.alerts.bulkAdd(alerts)
    }

    // 合并到已有 alerts
    set((s) => ({
      alerts: [...alerts, ...s.alerts],
      scanning: false,
    }))

    return alerts
  },

  loadAlerts: async () => {
    const alerts = await db.alerts.orderBy('triggeredAt').reverse().toArray()
    set({ alerts })
  },

  markAlertExecuted: async (alertId) => {
    const now = new Date().toISOString()
    await db.alerts.update(alertId, { executed: true, executedAt: now })
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, executed: true, executedAt: now } : a)),
    }))
  },

  dismissAlert: async (alertId) => {
    await db.alerts.update(alertId, { dismissed: true })
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, dismissed: true } : a)),
    }))
  },
}))

function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case 'lt': return value < threshold
    case 'gt': return value > threshold
    case 'lte': return value <= threshold
    case 'gte': return value >= threshold
  }
}

function cmpLabel(c: Comparator): string {
  return { lt: '<', gt: '>', lte: '≤', gte: '≥' }[c]
}
