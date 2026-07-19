import { create } from 'zustand'
import { db } from './db'
import { deleteEtfMappingCache } from '@/services/klineCache'
import type { UserSettings } from '@/types'

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
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loading: false,

  loadSettings: async () => {
    set({ loading: true })
    try {
      const saved = await db.settings.get('user-settings')
      if (saved) {
        set({ settings: { ...defaultSettings, ...saved }, loading: false })
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
}))
