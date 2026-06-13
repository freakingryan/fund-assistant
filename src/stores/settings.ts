import { create } from 'zustand'
import { db } from './db'
import type { UserSettings } from '@/types'

const defaultSettings: UserSettings = {
  theme: 'system',
  aiConfigs: [],
  defaultAIProvider: 'deepseek',
  dataSource: {
    tushareToken: '',
    primarySource: 'tushare',
  },
  storage: {
    type: 'local',
  },
  notifications: {
    browser: true,
    feishu: false,
    schedule: '0 20 * * 1-5',
  },
  etfMappings: [],
}

interface SettingsState {
  settings: UserSettings
  loading: boolean

  loadSettings: () => Promise<void>
  updateSettings: (data: Partial<UserSettings>) => Promise<void>
  updateAIConfig: (aiConfigs: UserSettings['aiConfigs']) => Promise<void>
  updateDataSource: (dataSource: Partial<UserSettings['dataSource']>) => Promise<void>
  updateStorage: (storage: Partial<UserSettings['storage']>) => Promise<void>
  updateNotifications: (notifications: Partial<UserSettings['notifications']>) => Promise<void>
  addEtfMapping: (otcCode: string, otcName: string, exchangeCode: string, exchangeName: string) => Promise<void>
  removeEtfMapping: (index: number) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
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

  updateSettings: async (data) => {
    const updated = { ...defaultSettings, ...data }
    await db.settings.put({ ...updated, id: 'user-settings' })
    set({ settings: updated })
  },

  updateAIConfig: async (aiConfigs) => {
    set((s) => {
      const updated = { ...s.settings, aiConfigs }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },

  updateDataSource: async (dataSource) => {
    set((s) => {
      const updated = { ...s.settings, dataSource: { ...s.settings.dataSource, ...dataSource } }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },

  updateStorage: async (storage) => {
    set((s) => {
      const updated = { ...s.settings, storage: { ...s.settings.storage, ...storage } }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },

  updateNotifications: async (notifications) => {
    set((s) => {
      const updated = { ...s.settings, notifications: { ...s.settings.notifications, ...notifications } }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },

  addEtfMapping: async (otcCode, otcName, exchangeCode, exchangeName) => {
    set((s) => {
      const updated = {
        ...s.settings,
        etfMappings: [...s.settings.etfMappings, { otcCode, otcName, exchangeCode, exchangeName }],
      }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },

  removeEtfMapping: async (index) => {
    set((s) => {
      const updated = { ...s.settings, etfMappings: s.settings.etfMappings.filter((_, i) => i !== index) }
      db.settings.put({ ...updated, id: 'user-settings' })
      return { settings: updated }
    })
  },
}))
