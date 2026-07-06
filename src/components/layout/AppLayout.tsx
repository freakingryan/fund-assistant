import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  WalletCards,
  TrendingUp,
  Bell,
  Settings,
  Menu,
  X,
  LineChart,
  SunMoon,
  Search,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { toast } from '@/components/ui/toast'
import InstallPrompt from './InstallPrompt'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '概览', end: true },
  { to: '/holdings', icon: WalletCards, label: '持仓管理' },
  { to: '/detail', icon: LineChart, label: '基金详情' },
  { to: '/plans', icon: TrendingUp, label: '投资计划' },
  { to: '/notifications', icon: Bell, label: '通知' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const theme = useSettingsStore((s) => s.settings.theme)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const navigate = useNavigate()

  // 全局搜索
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!globalSearch.trim() || globalSearch.trim().length < 2) {
      if (searchResults.length > 0) setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await dataSourceService.searchFunds(globalSearch.trim())
        setSearchResults(results.slice(0, 15))
      } catch { toast({ type: 'error', message: '搜索失败，请稍后重试' }); setSearchResults([]) }
      setSearchLoading(false)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [globalSearch])

  // 点击外部关闭搜索结果
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearchSelect = (_code: string) => {
    setGlobalSearch('')
    setSearchResults([])
    navigate(`/holdings`)
  }

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    updateSettings({ theme: next })
  }

  const themeLabel = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card border-r transition-transform duration-200 lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo */}
          <div className="flex h-14 items-center gap-2 px-4 border-b">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <TrendingUp className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">基金投资助手</span>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1 p-3">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <Separator />
        </aside>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            {/* 全局搜索 */}
            <div ref={searchRef} className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="搜索基金/ETF..."
                autoComplete="off"
                name="fund-global-search"
                className="pl-8 h-8 text-xs bg-background dark:bg-muted/30 dark:border-muted dark:text-foreground"
              />
              {searchLoading && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              {searchResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-72 overflow-auto">
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b">
                    找到 {searchResults.length} 个结果，点击跳转到持仓管理
                  </div>
                  {searchResults.map((r) => (
                    <button
                      key={r.code}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent text-left cursor-pointer"
                      onClick={() => handleSearchSelect(r.code)}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground w-20">{r.code.replace(/^(SZ|SH)/, '')}</span>
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1" />
            <button
              onClick={cycleTheme}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded cursor-pointer"
              title={`主题: ${themeLabel}（点击切换）`}
            >
              <SunMoon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{themeLabel}</span>
            </button>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto p-2 sm:p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <InstallPrompt />
    </TooltipProvider>
  )
}
