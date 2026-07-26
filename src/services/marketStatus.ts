/**
 * 市场状态（交易时段）共享服务 + React hook
 *
 * 从 marketBreadth.ts 抽取，避免 Dashboard 卡与市场状态护栏重复实现。
 * 底层仅用 stock-sdk 的 `calendar.getMarketStatus("CN")`（纯时间计算，无网络、不依赖东财开关）。
 *
 * 护栏核心判定：`isMarketOpen()` —— 仅在交易时段（open，不含午休）为 true。
 *
 * @module marketStatus
 */

import { useEffect, useState } from "react";
import type { MarketStatus } from "stock-sdk";
import StockSDK from "stock-sdk";

/** 市场状态 → 中文标签（纯计算，与交易时段对应） */
export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  pre_market: "盘前",
  open: "交易中",
  lunch_break: "午休",
  after_hours: "盘后",
  closed: "休市",
};

/** 市场状态 → 语义色调（用于徽标配色） */
export const MARKET_STATUS_TONE: Record<MarketStatus, "up" | "down" | "neutral"> = {
  pre_market: "neutral",
  open: "up",
  lunch_break: "neutral",
  after_hours: "neutral",
  closed: "down",
};

/** 当前 A 股市场状态（纯时间计算，无网络） */
export function getMarketStatusCN(): MarketStatus {
  return new StockSDK().calendar.getMarketStatus("CN");
}

/** 是否处于连续交易时段（open，不含午休 / 盘前 / 盘后 / 休市） */
export function isMarketOpen(status: MarketStatus = getMarketStatusCN()): boolean {
  return status === "open";
}

/** 下一交易时段（open）开始的本地时间；当前已在交易中返回 null */
export function nextSessionOpen(
  status: MarketStatus = getMarketStatusCN(),
  now: Date = new Date(),
): Date | null {
  if (status === "open") return null;
  const candidate = new Date(now);
  if (status === "lunch_break") {
    candidate.setHours(13, 0, 0, 0);
    if (candidate > now) return candidate;
  } else if (status === "pre_market") {
    candidate.setHours(9, 30, 0, 0);
    if (candidate > now) return candidate;
  }
  // after_hours / closed 或午休已过 → 下一工作日 9:30
  const next = new Date(now);
  next.setHours(9, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

export interface MarketStatusSnapshot {
  status: MarketStatus;
  label: string;
  isOpen: boolean;
  nextOpenAt: Date | null;
}

/** 取一份当前市场状态快照 */
export function getMarketStatusSnapshot(): MarketStatusSnapshot {
  const status = getMarketStatusCN();
  return {
    status,
    label: MARKET_STATUS_LABEL[status],
    isOpen: isMarketOpen(status),
    nextOpenAt: nextSessionOpen(status),
  };
}

/**
 * React hook：订阅市场状态，默认每 30 秒刷新一次。
 * 用于状态条、护栏文案、非交易时段倒计时。
 */
export function useMarketStatus(intervalMs = 30_000): MarketStatusSnapshot {
  const [snap, setSnap] = useState<MarketStatusSnapshot>(() => getMarketStatusSnapshot());
  useEffect(() => {
    const tick = () => setSnap(getMarketStatusSnapshot());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return snap;
}
