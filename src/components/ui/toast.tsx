import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, X } from 'lucide-react'

interface ToastData {
  type: 'success' | 'error'
  message: string
}

let toastFn: ((data: ToastData) => void) | null = null

export function toast(data: ToastData) {
  toastFn?.(data)
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<(ToastData & { id: number })[]>([])

  useEffect(() => {
    toastFn = (data) => {
      const id = Date.now()
      setToasts((prev) => [...prev, { ...data, id }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3000)
    }
    return () => { toastFn = null }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-sm animate-in slide-in-from-right',
            t.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800',
          )}
        >
          {t.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span className="flex-1 text-xs">{t.message}</span>
          <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
            <X className="h-3 w-3 opacity-60 hover:opacity-100" />
          </button>
        </div>
      ))}
    </div>
  )
}
