import { create } from 'zustand'
import { db } from './db'
import { deleteEtfMappingCache } from '@/services/klineCache'
import type { UserSettings } from '@/types'

/** 普通对象判断（用于深合并嵌套配置） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 深合并设置：对嵌套普通对象逐层合并，用于兼容旧版本持久化数据。
 * 旧数据若缺失嵌套字段（如 dataSource 缺 eastmoney），用默认值补齐，
 * 防止浅合并 `saved.dataSource:{}` 直接覆盖默认对象导致运行时读取 undefined 崩溃。
 */
function deepMergeSettings<T>(base: T, override: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const k of Object.keys(override)) {
    const ov = (override as Record<string, unknown>)[k]
    const bv = (base as Record<string, unknown>)[k]
    out[k] = isPlainObject(ov) && isPlainObject(bv) ? deepMergeSettings(bv, ov) : ov
  }
  return out as T
}

const defaultSettings: UserSettings = {
  theme: 'system',
  aiConfigs: [],
  defaultAIProvider: 'deepseek',
  storage: {
    type: 'local',
  },
  notifications: {
    browser: true,
    feishu: false,
    schedule: '0 20 * * 1-5',
  },
  etfMappings: [],
  sync: {
    gistToken: '',
    gistId: '',
    autoPush: true,
    lastAutoPush: null,
    lastAutoPushAttempt: null,
  },
  dataSource: {
    eastmoney: {
      enabled: false,
      mode: 'direct',
      proxyUrl: '',
    },
  },
}

interface SettingsState {
  settings: UserSettings
  loading: boolean

  loadSettings: () => Promise<void>
  updateSettings: (data: Partial<UserSettings>) => Promise<void>
  updateAIConfig: (aiConfigs: UserSettings['aiConfigs']) => Promise<void>
  updateStorage: (storage: Partial<UserSettings['storage']>) => Promise<void>
  updateNotifications: (notifications: Partial<UserSettings['notifications']>) => Promise<void>
  addEtfMapping: (otcCode: string, otcName: string, exchangeCode: string, exchangeName: string) => Promise<void>
  updateEtfMapping: (index: number, mapping: { otcCode: string; otcName: string; exchangeCode: string; exchangeName: string }) => Promise<void>
  removeEtfMapping: (index: number) => Promise<void>
  updateDataSource: (dataSource: Partial<UserSettings['dataSource']>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loading: false,

  loadSettings: async () => {
    set({ loading: true })
    try {
      const saved = await db.settings.get('user-settings')
      if (saved) {
        // 深合并补齐旧版本持久化数据缺失的嵌套字段（如 dataSource.eastmoney），
        // 并回写归一化后的设置，避免后续加载再次因浅合并覆盖而崩溃。
        const merged = deepMergeSettings(defaultSettings, saved as Partial<UserSettings>)
        await db.settings.put({ ...merged, id: 'user-settings' })
        set({ settings: merged, loading: false })
      } else {
        await db.settings.put({ ...defaultSettings, id: 'user-settings' })
        set({ settings: defaultSettings, loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  // C2 fix: use current settings as base, not defaults
  updateSettings: async (data) => {
    const current = get().settings
    const updated = { ...current, ...data }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  // I4 fix: use get/set with proper await
  updateAIConfig: async (aiConfigs) => {
    const current = get().settings
    const updated = { ...current, aiConfigs }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  updateStorage: async (storage) => {
    const current = get().settings
    const updated = { ...current, storage: { ...current.storage, ...storage } }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  updateNotifications: async (notifications) => {
    const current = get().settings
    const updated = { ...current, notifications: { ...current.notifications, ...notifications } }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  addEtfMapping: async (otcCode, otcName, exchangeCode, exchangeName) => {
    const current = get().settings
    const updated = {
      ...current,
      etfMappings: [...current.etfMappings, { otcCode, otcName, exchangeCode, exchangeName }],
    }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  updateEtfMapping: async (index, mapping) => {
    const current = get().settings
    const list = current.etfMappings.slice()
    if (index < 0 || index >= list.length) return
    const prev = list[index]
    if (prev.otcCode !== mapping.otcCode) {
      // 场外代码变更 → 旧缓存失效
      await deleteEtfMappingCache(prev.otcCode)
    }
    list[index] = { ...mapping }
    const updated = { ...current, etfMappings: list }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
    // 新代码若被其他位置引用，刷新其缓存
    await deleteEtfMappingCache(mapping.otcCode)
  },

  removeEtfMapping: async (index) => {
    const current = get().settings
    const target = current.etfMappings[index]
    if (target) await deleteEtfMappingCache(target.otcCode)
    const updated = { ...current, etfMappings: current.etfMappings.filter((_, i) => i !== index) }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  updateDataSource: async (dataSource) => {
    const current = get().settings
    const updated = { ...current, dataSource: { ...current.dataSource, ...dataSource } }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },
}))
