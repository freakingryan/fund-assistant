/**
 * 数据备份/同步服务
 * 统一数据格式：JSON 对象，包含所有 DB 表数据
 */

import { db } from '@/stores/db'
import type { FundHolding, InvestmentPlan, PlanAlert, UserSettings } from '@/types'

/** 备份/同步的 JSON 数据格式 */
export interface BackupData {
  version: number
  exportedAt: string
  appName: string
  holdings: FundHolding[]
  plans: InvestmentPlan[]
  alerts: PlanAlert[]
  settings: UserSettings[]
}

const CURRENT_VERSION = 1

/**
 * 从 IndexedDB 导出所有数据
 */
export async function exportAllData(): Promise<BackupData> {
  const [holdings, plans, alerts, settings] = await Promise.all([
    db.holdings.toArray(),
    db.plans.toArray(),
    db.alerts.toArray(),
    db.settings.toArray(),
  ])

  return {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: 'fund-assistant',
    holdings,
    plans,
    alerts,
    settings,
  }
}

/**
 * 导入数据到 IndexedDB（覆盖式）
 */
export async function importAllData(backup: BackupData): Promise<void> {
  if (backup.appName !== 'fund-assistant') {
    throw new Error('数据格式不匹配，不是本应用导出的数据')
  }

  await db.transaction('rw', db.holdings, db.plans, db.alerts, db.settings, async () => {
    // 清空旧数据
    await Promise.all([
      db.holdings.clear(),
      db.plans.clear(),
      db.alerts.clear(),
      db.settings.clear(),
    ])

    // 写入新数据
    if (backup.holdings.length > 0) await db.holdings.bulkAdd(backup.holdings)
    if (backup.plans.length > 0) await db.plans.bulkAdd(backup.plans)
    if (backup.alerts.length > 0) await db.alerts.bulkAdd(backup.alerts)
    if (backup.settings.length > 0) await db.settings.bulkAdd(backup.settings)
  })
}

/**
 * 下载 JSON 文件到本地
 */
export function downloadBackup(data: BackupData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fund-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 用户选择 JSON 文件后读取
 */
export function readBackupFile(): Promise<BackupData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) { reject(new Error('未选择文件')); return }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string)
          resolve(data as BackupData)
        } catch (_err) {
          reject(new Error('文件格式错误，无法解析'))
        }
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

// ── GitHub Gist 同步 ───────────────────────

const GIST_API = 'https://api.github.com/gists'
const GIST_FILENAME = 'fund-assistant-data.json'
const GIST_DESCRIPTION = '基金投资助手 - 数据备份'

/**
 * 上传数据到 GitHub Gist（创建或更新）
 */
export async function syncToGist(token: string, gistId: string | null, data: BackupData): Promise<string> {
  const body = {
    description: GIST_DESCRIPTION,
    public: false,
    files: {
      [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) },
    },
  }

  // 有 gistId 则更新，否则创建
  const url = gistId ? `${GIST_API}/${gistId}` : GIST_API
  const method = gistId ? 'PATCH' : 'POST'

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitHub Gist 同步失败 (${res.status}): ${err}`)
  }

  const result = await res.json()
  // 返回 gist ID（新建时才有，更新时也返回原 id）
  return result.id
}

/**
 * 从 GitHub Gist 下载数据
 */
export async function loadFromGist(token: string, gistId: string): Promise<BackupData> {
  const res = await fetch(`${GIST_API}/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitHub Gist 读取失败 (${res.status}): ${err}`)
  }

  const gist = await res.json()
  const file = gist.files?.[GIST_FILENAME]
  if (!file?.content) throw new Error('Gist 中未找到备份数据文件')

  return JSON.parse(file.content) as BackupData
}

/**
 * 验证 GitHub Token 是否有效（只读访问 /user 端点）
 */
export async function verifyGistToken(token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) {
      if (res.status === 401) return { ok: false, message: 'Token 无效或已过期，请重新生成' }
      return { ok: false, message: `GitHub API 响应异常 (${res.status})` }
    }
    const user = await res.json()
    return { ok: true, message: `登录用户: ${user.login}` }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

/**
 * 在用户的 Gist 列表中查找基金投资助手的备份 Gist
 * 用于新设备恢复：用户输入 Token 后自动找到已有的备份
 */
export async function findFundGist(token: string): Promise<string | null> {
  const res = await fetch(`${GIST_API}?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) {
      throw new Error(`GitHub Token 无效或未勾选 gist 权限。请在 https://github.com/settings/tokens 检查：\n1) Token 已勾选 gist scope\n2) Token 未过期\n3) 该 Token 与旧设备使用的是同一个 GitHub 账号 (当前账号: 请到备份页点击"验证Token"查看)`)
    }
    throw new Error(`查询 Gist 列表失败 (${res.status}): ${body.slice(0, 100)}`)
  }
  const gists = await res.json()
  const found = gists.find((g: any) =>
    g.files?.[GIST_FILENAME] || g.description === GIST_DESCRIPTION
  )
  return found?.id || null
}
