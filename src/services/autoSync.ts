/**
 * 每日自动同步服务
 * 在 App 启动与定时器中调用：若启用「每日自动同步」且已配置 Gist，
 * 距上次成功推送超过 24h 则自动推送到 Gist；成功后在通知中展示。
 */

import { exportAllData, syncToGist } from './backup'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'

const DAY_MS = 24 * 60 * 60 * 1000
// 失败后最短重试间隔，避免频繁失败刷接口
const RETRY_GAP_MS = 6 * 60 * 60 * 1000

/**
 * 执行一次每日自动推送（幂等、带节流）。
 * - 未启用 / 未配置 Token 或 GistId → 直接返回
 * - 距上次成功推送 < 24h → 跳过
 * - 距上次尝试（含失败）< 6h → 跳过（失败退避）
 */
export async function runDailyGistPush(): Promise<void> {
  const sync = useSettingsStore.getState().settings.sync
  if (!sync.autoPush) return
  if (!sync.gistToken || !sync.gistId) return // 尚未配置，跳过且不记录尝试

  const now = Date.now()
  if (sync.lastAutoPush && now - sync.lastAutoPush < DAY_MS) return
  if (sync.lastAutoPushAttempt && now - sync.lastAutoPushAttempt < RETRY_GAP_MS) return

  // 标记本次尝试，防止失败后立即重试
  useSettingsStore.getState().updateSettings({
    sync: { ...useSettingsStore.getState().settings.sync, lastAutoPushAttempt: now },
  })

  try {
    const data = await exportAllData()
    const gistId = await syncToGist(sync.gistToken, sync.gistId, data)
    const time = new Date().toLocaleString('zh-CN', { hour12: false })
    // 成功：记录时间并（若首次）保存 gistId
    useSettingsStore.getState().updateSettings({
      sync: {
        ...useSettingsStore.getState().settings.sync,
        lastAutoPush: Date.now(),
        gistId: gistId || sync.gistId,
      },
    })
    await useNotificationsStore.getState().addNotification({
      type: 'success',
      title: '每日备份已同步到 Gist',
      body: `已备份 ${data.holdings.length} 只持仓、${data.plans.length} 个计划 · ${time}`,
    })
  } catch (e) {
    // 失败：仅记录日志，不更新 lastAutoPush → 达到退避间隔后自动重试
    console.error('[自动同步] 每日 Gist 推送失败:', e)
  }
}
