import Dexie, { type EntityTable } from 'dexie'
import type { FundHolding, InvestmentPlan, PlanAlert, UserSettings } from '@/types'

export class FundAssistantDB extends Dexie {
  holdings!: EntityTable<FundHolding, 'id'>
  plans!: EntityTable<InvestmentPlan, 'id'>
  alerts!: EntityTable<PlanAlert, 'id'>
  settings!: EntityTable<UserSettings, 'id'>

  constructor() {
    super('FundAssistantDB')

    this.version(2).stores({
      holdings: 'id, code, market, type, sector, purchaseDate',
      plans: 'id, enabled',
      alerts: 'id, fundCode, triggeredAt',
      settings: 'id',
    })
  }
}

export const db = new FundAssistantDB()
