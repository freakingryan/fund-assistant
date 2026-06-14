import Dexie, { type EntityTable } from 'dexie'
import type { FundHolding, InvestmentPlan, PlanAlert, UserSettings } from '@/types'

export class FundAssistantDB extends Dexie {
  holdings!: EntityTable<FundHolding, 'id'>
  plans!: EntityTable<InvestmentPlan, 'id'>
  alerts!: EntityTable<PlanAlert, 'id'>
  settings!: EntityTable<UserSettings, 'id'>

  constructor() {
    super('FundAssistantDB')

    // v1 (dev): holdings, plans (per-fund), planLogs, settings
    // v2 (current): plans (global single plan), alerts (replaces planLogs)
    this.version(2).stores({
      holdings: 'id, code, market, type, sector, purchaseDate',
      plans: 'id, enabled',
      alerts: 'id, fundCode, triggeredAt',
      settings: 'id',
    }).upgrade(async (tx) => {
      // C4 fix: 记录迁移；v1 到 v2 的 planLogs→alerts 变更在开发阶段，无需迁移旧数据
      console.warn('[DB] Upgrading from v1 to v2')
    })
  }
}

export const db = new FundAssistantDB()
