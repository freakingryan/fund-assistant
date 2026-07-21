/**
 * 持仓成本解析 —— 单一真理来源
 *
 * 持仓成本有两种录入方式：
 *  - 方式一：用户直接录入 `costNAV`（成本净值/单价）+ `shares`（份额）
 *  - 方式二：用户录入 `holdingAmount`（当前市值，已含收益）+ `holdingProfit`（持有收益）
 *
 * 方式二需要按「当前净值」反算份额与成本净值，才能算出收益率/累计盈亏。
 * 此前日报（computePortfolio）与计划扫描（scan）各写了一遍推导逻辑，
 * 且都要求 `shares > 0` 才算成本已知，导致**只填方式二、没填份额**的持仓
 * 在日报/提醒里被标记为「成本未知 / 成本=0」——而持仓表/详情页却在显示时
 * 反算出了正确值。本模块把这段逻辑抽成工具，供数据层与 UI 共用，杜绝漂移。
 *
 * @module holdingCost
 */

import type { FundHolding } from '@/types'

export type CostMethod = 'stored' | 'derived' | 'unknown'

export interface ResolvedCost {
  /** 投入本金（总成本，方式一：costNAV×shares；方式二：holdingAmount-holdingProfit） */
  costValue: number
  /** 持仓成本净值（单价）。方式二无实时净值时为 0（但盈亏仍可算） */
  costNAV: number
  /** 持有份额（方式二下为按当前净值反算；无净值时为 0） */
  shares: number
  /**
   * 单价成本是否已知（可显示「成本净值/份额」）。
   * 方式二在无实时净值时 costNAV=0 → costKnown=false，但盈亏仍可算（见 pnlKnown）。
   * false 时 UI 单价成本行可显示「成本未知」或回退显示本金。
   */
  costKnown: boolean
  /**
   * 盈亏是否已知（可计算收益率/累计盈亏）。
   * 方式一：有 costNAV+shares 即 true；
   * 方式二：只要有 holdingAmount（可反算本金）即 true，无需实时净值——收益率/盈亏
   *         直接由 holdingProfit 得出，这正是此前日报/提醒误报「成本未知」的根源。
   */
  pnlKnown: boolean
  /** 当前收益率 (%)，方式一/二均可直接得出；未知时为 0 */
  returnRate: number
  /** 累计盈亏（元），方式一/二均可直接得出；未知时为 0 */
  totalPnl: number
  /** 来源：stored=用户录入；derived=由方式二反算；unknown=无成本数据 */
  method: CostMethod
}

/**
 * 解析一只持仓的有效成本。
 * @param h 持仓记录
 * @param currentNAV 该基金最新净值（用于方式二反算份额）。缺失传 0。
 *
 * 关键设计：方式二（holdingAmount + holdingProfit）的收益率/累计盈亏只依赖
 * holdingProfit，与实时净值解耦；只有「单价成本净值/份额」需要净值。
 * 因此 pnlKnown 与 costKnown 解耦——这正是修复「日报/提醒显示成本未知」的核心。
 */
export function resolveHoldingCost(h: FundHolding, currentNAV: number): ResolvedCost {
  const nav = currentNAV > 0 ? currentNAV : 0
  const storedCostNAV = h.costNAV || 0
  const storedShares = h.shares || 0
  const holdingAmount = h.holdingAmount || 0
  const holdingProfit = h.holdingProfit || 0

  // 方式一：用户直接录入成本净值 + 份额 —— 优先采用，最精确
  if (storedCostNAV > 0 && storedShares > 0) {
    const costValue = storedCostNAV * storedShares
    return {
      costValue,
      costNAV: storedCostNAV,
      shares: storedShares,
      costKnown: true,
      pnlKnown: true,
      // 收益率/盈亏需当前净值；无净值（行情缺失）时置 0，UI 应据此隐藏
      returnRate: nav > 0 ? ((nav - storedCostNAV) / storedCostNAV) * 100 : 0,
      totalPnl: nav > 0 ? (nav - storedCostNAV) * storedShares : 0,
      method: 'stored',
    }
  }

  // 方式二：持有金额 + 持有收益 → 反算本金；盈亏与实时净值解耦，无需净值即可得
  if (holdingAmount > 0) {
    const principal = holdingAmount - holdingProfit
    const pnlKnown = principal > 0
    // 份额 = 当前市值 / 当前净值（保留两位小数，与 UI 一致）；无净值则 0
    const shares = nav > 0 ? Math.round((holdingAmount / nav) * 100) / 100 : 0
    const costNAV = shares > 0 ? principal / shares : 0
    // 收益率/累计盈亏直接由 holdingProfit 反算，与实时净值无关
    const returnRate = pnlKnown ? (holdingProfit / principal) * 100 : 0
    const totalPnl = pnlKnown ? holdingProfit : 0
    return {
      costValue: principal,
      costNAV,
      shares,
      costKnown: costNAV > 0 && shares > 0,
      pnlKnown,
      returnRate,
      totalPnl,
      method: 'derived',
    }
  }

  return {
    costValue: 0,
    costNAV: 0,
    shares: storedShares,
    costKnown: false,
    pnlKnown: false,
    returnRate: 0,
    totalPnl: 0,
    method: 'unknown',
  }
}
