import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, X } from 'lucide-react'

/**
 * PWA 安装提示横幅
 * 当浏览器支持 beforeinstallprompt 且用户未接受/拒绝时显示
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // 已安装则不再提示
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShow(false)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    if (result.outcome === 'accepted') setShow(false)
    setDeferredPrompt(null)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto bg-card border rounded-lg shadow-lg p-3 flex items-center gap-3 animate-in slide-in-from-bottom">
      <Download className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">安装基金投资助手</p>
        <p className="text-[10px] text-muted-foreground">添加到主屏幕，离线可用</p>
      </div>
      <Button size="sm" className="h-7 text-xs shrink-0" onClick={handleInstall}>安装</Button>
      <button onClick={() => setShow(false)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
