/**
 * 投资体检 SOP — 决策日志存储服务。
 * 封装对 IndexedDB `decisionLogs` 表的读写，供向导最后一步存档用户自我判断。
 *
 * @module services/guide/decisionLog
 */

import { db } from "@/stores/db";
import type { DecisionLog } from "@/types";

/** 存档一条决策日志（幂等：同 id 覆盖） */
export async function saveDecisionLog(log: DecisionLog): Promise<void> {
  await db.decisionLogs.put(log);
}

/**
 * 读取决策日志，默认按时间倒序。
 * @param code 可选基金代码；不传则返回全部基金的日志
 */
export async function getDecisionLogs(code?: string): Promise<DecisionLog[]> {
  const all = await db.decisionLogs.orderBy("createdAt").reverse().toArray();
  return code ? all.filter((l) => l.fundCode === code) : all;
}

/** 读取某基金最新一条决策日志（无则 undefined） */
export async function getLatestDecisionLog(code: string): Promise<DecisionLog | undefined> {
  const logs = await getDecisionLogs(code);
  return logs[0];
}
