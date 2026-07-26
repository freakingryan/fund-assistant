/**
 * 浏览器通知服务
 * 使用 Notification API 在本地推送提醒
 */

/**
 * 检查并请求通知权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * 发送一条浏览器通知
 */
export function sendNotification(title: string, options?: NotificationOptions): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const n = new Notification(title, {
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      silent: false,
      ...options,
    });

    // 点击通知时聚焦页面
    n.onclick = () => {
      window.focus();
      n.close();
    };

    // 自动关闭（5秒后）
    setTimeout(() => n.close(), 5000);
  } catch {
    /* 静默处理 */
  }
}

/**
 * 发送投资计划提醒通知
 * 已迁移到统一 `notify()`（services/notify.ts）；计划提醒应调用
 * `notify({ type: "warning", title: ..., body: ..., channels: ["browser", "feishu"] })`，
 * 避免写入 in-app 铃铛（与 usePlansStore.alerts 区分）。
 */
