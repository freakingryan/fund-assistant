import Dexie, { type EntityTable } from 'dexie'
import type { FundHolding, InvestmentPlan, PlanAlert, UserSettings } from '@/types'

export class FundAssistantDB extends Dexie {
  holdings!: EntityTable<FundHolding, 'id'>
  plans!: EntityTable<InvestmentPlan, 'id'>
  alerts!: EntityTable<PlanAlert, 'id'>
  settings!: EntityTable<UserSettings, 'id'>
  klineCache!: EntityTable<{ id: string; code: string; period: string; data: any[]; cachedAt: number }, 'id'>

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
      console.warn('[DB] Upgrading from v1 to v2')
    })

    // v3: klineCache — K 线数据本地缓存
    this.version(3).stores({
      klineCache: 'id, code, period, cachedAt',
    })
  }
}

export const db = new FundAssistantDB()
