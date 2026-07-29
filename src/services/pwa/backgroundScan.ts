/**
 * Service Worker 后台扫描编排（SW 安全）
 *
 * 由自定义 SW（src/pwa/sw.ts）在 `periodicsync` / `push` 事件触发时调用。
 * 流程：读设置 → 校验开关 → 读持仓/计划/去重态 → 调用共享的 evaluatePlanRules
 * （与 App 前台 scan 同一套规则语义）→ 持久化命中提醒 → 经 SW 噪声闸门弹浏览器通知。
 *
 * 本模块只会被 SW 引入，不会进入主应用 bundle；其中使用的 `self.registration`
 * 仅在 Service Worker 全局可用。
 *
 * @module pwa/backgroundScan
 */

import type { PlanAlert, UserSettings } from "@/types";
import { db } from "@/stores/db";
import { evaluatePlanRules } from "@/services/plans/scanCore";
import { buildSWStrategy, swPassNoiseGate } from "./scanCapabilities";

/** 已存在且未处理的提醒键集合（fundCode|ruleId），用于扫描去重 */
async function buildExistingKeysSW(): Promise<Set<string>> {
  const existing = await db.alerts.filter((a) => !a.executed && !a.dismissed).toArray();
  return new Set(existing.map((a) => `${a.fundCode}|${a.ruleId}`));
}

/** DCA 规则去重：每只基金最近一次 dca 提醒时间 */
async function buildDcaAlertMapSW(): Promise<Map<string, string>> {
  const dcaAlerts = await db.alerts.filter((a) => a.ruleType === "dca").toArray();
  const map = new Map<string, string>();
  for (const a of dcaAlerts) {
    const key = `${a.fundCode}|dca`;
    const prev = map.get(key);
    if (!prev || a.triggeredAt > prev) map.set(key, a.triggeredAt);
  }
  return map;
}

/** 经 SW 噪声闸门后弹出浏览器通知 */
async function showPlanNotificationSW(alert: PlanAlert, settings: UserSettings): Promise<void> {
  const title = `计划提醒 · ${alert.fundName}`;
  const body = alert.reason;
  const passed = await swPassNoiseGate({ type: "warning", title }, settings);
  if (!passed) return;

  // 结构化访问 SW 注册对象（避免引入 webworker lib 依赖，保持主工程类型干净）
  const registration = (
    self as unknown as {
      registration?: {
        showNotification: (title: string, opts?: Record<string, unknown>) => Promise<void>;
      };
    }
  ).registration;

  try {
    await registration?.showNotification(title, {
      body,
      icon: "/fund-assistant/icons/icon-192.png",
      badge: "/fund-assistant/icons/icon-192.png",
      tag: `plan-alert-${alert.fundCode}`,
      // 点击通知 → 打开应用并聚焦（由 sw.ts notificationclick 处理）
      data: { url: "/fund-assistant/", fundCode: alert.fundCode, alertId: alert.id },
      requireInteraction: false,
    });
  } catch {
    // 通知弹窗失败（如系统限制）静默忽略，不影响下次扫描
  }
}

/**
 * 执行一次后台扫描。返回本次新增的提醒数（便于调试）。
 * 若无持仓 / 计划未启用 / 后台扫描开关关闭，直接返回 0。
 */
export async function runBackgroundScan(): Promise<number> {
  try {
    const settings = await db.settings.get("user-settings");
    if (!settings) return 0;
    // Phase 17 开关：未开启则不后台扫描
    if (!settings.notifications.backgroundScan) return 0;

    const plan = await db.plans.get("global-plan");
    if (!plan || !plan.enabled) return 0;

    const holdings = await db.holdings.toArray();
    if (holdings.length === 0) return 0;

    const alerts = await evaluatePlanRules({
      holdings,
      plan,
      strategy: buildSWStrategy(settings.etfMappings ?? []),
      dedup: {
        existingKeys: await buildExistingKeysSW(),
        dcaAlertMap: await buildDcaAlertMapSW(),
      },
    });

    if (alerts.length === 0) return 0;

    // 持久化命中提醒（与 App 扫描同一张 alerts 表，应用内铃铛也能看到历史）
    await db.alerts.bulkAdd(alerts);
    for (const a of alerts) {
      await showPlanNotificationSW(a, settings);
    }
    return alerts.length;
  } catch (e) {
    // 后台扫描失败不应阻塞 SW 生命周期
    console.warn("[backgroundScan] 扫描失败", (e as Error)?.message ?? e);
    return 0;
  }
}
