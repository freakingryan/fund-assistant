import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useEffect, useState, Component } from 'react'
import { useHoldingsStore } from './stores/holdings'
import { useSettingsStore } from './stores/settings'
import { usePlansStore } from './stores/plans'
import { useNotificationsStore } from './stores/notifications'
import { runDailyGistPush } from './services/autoSync'
import { captureDailySnapshots, reconcileSnapshots, backfillMissingTradingDays, isFundDataReady, localDateKey } from './services/backtest/decisionSnapshot'
import { isTradingDay } from './lib/tradingCalendar'
import { sendAlertBatch } from './services/notification'
import ToastContainer from './components/ui/toast'
import InstallPrompt from './components/layout/InstallPrompt'
import { AlertCircle } from 'lucide-react'
import { Button } from './components/ui/button'

// #29: ErrorBoundary — 防止某组件崩溃导致整个 App 白屏
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-center space-y-3 p-8">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
            <h2 className="text-lg font-semibold">应用出现异常</h2>
            <p className="text-sm text-muted-foreground">请刷新页面重试，或清除浏览器数据后重新加载。</p>
            <Button onClick={() => { this.setState({ hasError: false }); window.location.reload() }}>
              刷新页面
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * 交易日交易时段内（周一至周五）是否打开，用于收盘前自动扫描。
 * 覆盖 9:30–15:00，但排除午间休市 11:30–13:00（基金申赎 15:00 截止）。
 *   - 上午盘：09:30–11:30
 *   - 午休：  11:30–13:00（跳过）
 *   - 下午盘：13:00–15:00
 */
function isTradingHoursOpen(now: Date = new Date()): boolean {
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const inMorning = mins >= 9 * 60 + 30 && mins < 11 * 60 + 30
  const inAfternoon = mins >= 13 * 60 && mins < 15 * 60
  return inMorning || inAfternoon
}

/**
 * 评分回测：每个交易日收盘后仅自动采集一次 + 回溯补齐最近缺失的交易日。
 * 1) 今日守卫：settings.backtest.lastAutoCaptureDate === today 则跳过今日采集，
 *    避免每 30 分钟定时复查重复读 Dexie / 发网络请求。
 *    仅当本地已过 15:00（isMarketClosed）才把今日标记为已采集——
 *    盘中空跑（capture 受门禁直接返回 0）不锁定当日，收盘后仍需真正采集一次。
 * 2) 回溯补齐：本次会话仅首次运行时，补齐最近 7 天内「尚无任何快照」的交易日，
 *    解决「用户只收盘前打开过一次、当日未采集、且之后再没打开」导致该日快照永久缺失的问题。
 *    补齐用截断 K 线（targetDate）避免前视偏差，天然幂等。
 */
let backtestBackfillRan = false
async function autoCaptureBacktestOnce() {
  const today = localDateKey()
  const meta = useSettingsStore.getState().settings.backtest
  // 今日采集（每日首次守卫）：仅基金数据公布后（工作日 ≥20:00，净值定稿）自动采一次，
  // 避免盘后早期（15:00–20:00）采到“昨日净值”当作今日基准；盘中/未到 20:00 不采且不锁当日。
  if (isTradingDay(new Date()) && meta?.lastAutoCaptureDate !== today) {
    if (isFundDataReady()) {
      await captureDailySnapshots() // force=false，遵守收盘门禁（≥15:00 已满足）
      await useSettingsStore.getState().updateBacktestMeta({ lastAutoCaptureDate: today })
    }
  }
  // 回溯补齐最近缺失的交易日（仅本次会话首次运行一次）
  if (!backtestBackfillRan) {
    backtestBackfillRan = true
    await backfillMissingTradingDays(7)
  }
}

export default function App() {
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadPlan = usePlansStore((s) => s.loadPlan)
  const theme = useSettingsStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // 监听系统暗色偏好
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Phase 6.5: 暗色模式 + 通知权限
  useEffect(() => {
    const isDark = theme === 'dark' || (theme === 'system' && systemDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [theme, systemDark])

  // 浏览器通知权限请求
  useEffect(() => {
    if (theme !== null && 'Notification' in window && Notification.permission === 'default') {
      // 只在用户启用浏览器通知时请求
      const notif = useSettingsStore.getState().settings.notifications.browser
      if (notif) Notification.requestPermission()
    }
  }, [theme])

  // 初始化数据
  useEffect(() => {
    const init = async () => {
      await loadSettings()
      await loadHoldings()
      await loadPlan()
      await useNotificationsStore.getState().loadNotifications()
      runDailyGistPush()

      // 收盘前自动扫描：交易时段内打开 App 即跑一次投资计划检查，新提醒推送浏览器通知。
      // scan() 内部按 fundCode|ruleId 去重，仅生成真正新增的提醒，不会重复打扰。
      if (isTradingHoursOpen()) {
        const plan = usePlansStore.getState().plan
        if (plan?.enabled) {
          const holdings = useHoldingsStore.getState().holdings
          if (holdings.length > 0) {
            try {
              const newAlerts = await usePlansStore.getState().scan(holdings)
              if (newAlerts.length > 0) {
                sendAlertBatch(newAlerts.map((a) => ({ fundName: a.fundName, reason: a.reason })))
              }
            } catch (e) {
              console.warn('[plans] 收盘前自动扫描失败', e)
            }
          }
        }
      }
      // 评分回测：收盘后自动补采当日快照（每日首次守卫）+ 回填次日涨跌（幂等，门禁内置）
      autoCaptureBacktestOnce().catch((e) => console.warn('[backtest] 自动采集失败', e))
      reconcileSnapshots().catch((e) => console.warn('[backtest] 自动回填失败', e))
    }
    init()
  }, [loadSettings, loadHoldings, loadPlan])

  // 每日自动同步：每 6 小时复查一次（长会话跨过 24h 窗口也能触发，间隔与失败退避对齐）
  useEffect(() => {
    const timer = setInterval(() => {
      runDailyGistPush()
    }, 6 * 60 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // 评分回测：每 30 分钟复查一次采集/回填（仅收盘后/已有次日数据时生效，幂等）
  useEffect(() => {
    const timer = setInterval(() => {
      autoCaptureBacktestOnce().catch((e) => console.warn('[backtest] 定时采集失败', e))
      reconcileSnapshots().catch((e) => console.warn('[backtest] 定时回填失败', e))
    }, 30 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <InstallPrompt />
      <ToastContainer />
    </ErrorBoundary>
  )
}
