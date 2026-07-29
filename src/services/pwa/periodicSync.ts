/**
 * Chromium Periodic Background Sync 注册封装。
 *
 * 该 API 仅在 Chromium 内核浏览器（Chrome / Edge 等）可用，Firefox / Safari 不支持。
 * 浏览器按自身策略控制最小触发间隔（Chromium 实际下限约 12 小时），`minInterval`
 * 仅作下限提示，不保证精确频率。注册成功后，后台（页面关闭）由 SW 的 `periodicsync`
 * 事件驱动 `runBackgroundScan()`，实现"脱离页面打开"的计划提醒。
 *
 * 前置条件：
 *  - 必须已通过 registerServiceWorker() 注册自定义 SW（production 构建）。
 *  - Notification.permission 必须为 "granted"（否则后台通知无法弹出，故 ensure 前由调用方请求权限）。
 *
 * @module pwa/periodicSync
 */

const DEFAULT_TAG = "plan-background-scan";
// Chromium 实际下限约 12h；此处声明下限，浏览器可能进一步拉长。单位毫秒。
const DEFAULT_MIN_INTERVAL = 12 * 60 * 60 * 1000;

// PeriodicSyncManager 不在标准 lib.dom 中，按结构最小化声明。
interface PeriodicSyncManagerLike {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}
interface RegistrationWithPeriodic {
  periodicSync?: PeriodicSyncManagerLike;
}

/**
 * 确保已注册周期后台同步任务。
 * @returns true 表示注册成功（或已存在）；false 表示环境不支持 / 注册失败。
 */
export async function ensurePeriodicSync(
  tag: string = DEFAULT_TAG,
  minInterval: number = DEFAULT_MIN_INTERVAL,
): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration &
      RegistrationWithPeriodic;
    const ps = reg.periodicSync;
    if (!ps) return false; // 非 Chromium / 不支持
    const tags = await ps.getTags();
    if (!tags.includes(tag)) {
      await ps.register(tag, { minInterval });
    }
    return true;
  } catch (e) {
    console.warn("[periodicSync] ensure 失败", (e as Error)?.message ?? e);
    return false;
  }
}

/**
 * 注销周期后台同步任务（关闭后台扫描时调用）。
 */
export async function unregisterPeriodicSync(tag: string = DEFAULT_TAG): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration &
      RegistrationWithPeriodic;
    const ps = reg.periodicSync;
    if (!ps) return;
    const tags = await ps.getTags();
    if (tags.includes(tag)) await ps.unregister(tag);
  } catch (e) {
    console.warn("[periodicSync] unregister 失败", (e as Error)?.message ?? e);
  }
}
