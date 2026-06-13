import Dexie, { type EntityTable } from 'dexie'
import type { FundHolding, InvestmentPlan, PlanLog, UserSettings } from '@/types'

export class FundAssistantDB extends Dexie {
  holdings!: EntityTable<FundHolding, 'id'>
  plans!: EntityTable<InvestmentPlan, 'id'>
  planLogs!: EntityTable<PlanLog, 'id'>
  settings!: EntityTable<UserSettings, 'id'>

  constructor() {
    super('FundAssistantDB')

    this.version(1).stores({
      holdings: 'id, code, market, type, sector, purchaseDate',
      plans: 'id, fundCode, enabled',
      planLogs: 'id, planId, fundCode, triggeredAt',
      settings: 'id',
    })
  }
}

export const db = new FundAssistantDB()
