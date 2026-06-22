import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useEffect, Component } from 'react'
import { useHoldingsStore } from './stores/holdings'
import { useSettingsStore } from './stores/settings'
import { usePlansStore } from './stores/plans'
import ToastContainer from './components/ui/toast'
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

export default function App() {
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadPlan = usePlansStore((s) => s.loadPlan)

  // 初始化数据
  useEffect(() => {
    loadSettings()
    loadHoldings()
    loadPlan()
  }, [loadSettings, loadHoldings, loadPlan])

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <ToastContainer />
    </ErrorBoundary>
  )
}
