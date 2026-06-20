import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(value: number, currency: string = 'CNY'): string {
  const symbols: Record<string, string> = { CNY: '¥', USD: '$', HKD: 'HK$' }
  return `${symbols[currency] || ''}${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/**
 * JSONP 请求（不受 CORS 限制，东财接口原生支持）
 */
export function jsonp<T>(url: string, callbackName = 'callback'): Promise<T> {
  return new Promise((resolve, reject) => {
    const cbName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    // 注册全局回调
    ;(window as any)[cbName] = (data: T) => {
      cleanup()
      resolve(data)
    }

    const cleanup = () => {
      delete (window as any)[cbName]
      script.remove()
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('JSONP 请求超时'))
    }, 10000)

    const script = document.createElement('script')
    const separator = url.includes('?') ? '&' : '?'
    script.src = `${url}${separator}${callbackName}=${cbName}`
    script.onerror = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new Error('JSONP 加载失败'))
    }
    document.head.appendChild(script)
  })
}
