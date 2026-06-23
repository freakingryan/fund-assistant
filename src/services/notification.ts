/**
 * 浏览器通知服务
 * 使用 Notification API 在本地推送提醒
 */

/**
 * 检查并请求通知权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false

  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false

  const result = await Notification.requestPermission()
  return result === 'granted'
}

/**
 * 发送一条浏览器通知
 */
export function sendNotification(title: string, options?: NotificationOptions): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  try {
    const n = new Notification(title, {
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      silent: false,
      ...options,
    })

    // 点击通知时聚焦页面
    n.onclick = () => {
      window.focus()
      n.close()
    }

    // 自动关闭（5秒后）
    setTimeout(() => n.close(), 5000)
  } catch { /* 静默处理 */ }
}

/**
 * 发送投资计划提醒通知
 */
export function sendAlertNotification(fundName: string, reason: string): void {
  sendNotification('基金投资助手 - 计划提醒', {
    body: `[${fundName}] ${reason}`,
    tag: `alert-${Date.now()}`,
  })
}

/**
 * 批量发送提醒通知（用于手动扫描后）
 */
export function sendAlertBatch(alerts: Array<{ fundName: string; reason: string }>): void {
  if (alerts.length === 0) return

  if (alerts.length === 1) {
    sendAlertNotification(alerts[0].fundName, alerts[0].reason)
    return
  }

  sendNotification(`基金投资助手 - ${alerts.length} 条计划提醒`, {
    body: `点击查看详情`,
    tag: 'alert-batch',
  })
}
