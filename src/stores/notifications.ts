import { create } from 'zustand'
import { db } from './db'
import type { AppNotification } from '@/types'

interface NotificationInput {
  type: AppNotification['type']
  title: string
  body?: string
}

interface NotificationsState {
  notifications: AppNotification[]
  loaded: boolean
  loadNotifications: () => Promise<void>
  addNotification: (input: NotificationInput) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  loaded: false,

  loadNotifications: async () => {
    try {
      const all = await db.notifications.orderBy('createdAt').reverse().toArray()
      set({ notifications: all, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  addNotification: async (input) => {
    const n: AppNotification = {
      id: genId(),
      type: input.type,
      title: input.title,
      body: input.body,
      createdAt: Date.now(),
      read: false,
    }
    try {
      await db.notifications.put(n)
    } catch {
      /* 本地存储失败不阻塞主流程 */
    }
    set({ notifications: [n, ...get().notifications] })
  },

  markRead: async (id) => {
    const item = get().notifications.find((n) => n.id === id)
    if (!item || item.read) return
    try {
      await db.notifications.update(id, { read: true })
    } catch {
      /* ignore */
    }
    set({
      notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })
  },

  markAllRead: async () => {
    const unread = get().notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    try {
      await Promise.all(unread.map((n) => db.notifications.update(n.id, { read: true })))
    } catch {
      /* ignore */
    }
    set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) })
  },

  remove: async (id) => {
    try {
      await db.notifications.delete(id)
    } catch {
      /* ignore */
    }
    set({ notifications: get().notifications.filter((n) => n.id !== id) })
  },

  clearAll: async () => {
    try {
      await db.notifications.clear()
    } catch {
      /* ignore */
    }
    set({ notifications: [] })
  },
}))

/** 未读数量选择器（用于铃铛徽标） */
export const selectUnreadCount = (s: NotificationsState): number =>
  s.notifications.reduce((acc, n) => (n.read ? acc : acc + 1), 0)
