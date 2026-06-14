import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useEffect } from 'react'
import { useHoldingsStore } from './stores/holdings'
import { useSettingsStore } from './stores/settings'
import { usePlansStore } from './stores/plans'

export default function App() {
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadPlan = usePlansStore((s) => s.loadPlan)

  useEffect(() => {
    loadSettings()
    loadHoldings()
    loadPlan()
  }, [loadSettings, loadHoldings, loadPlan])

  return <RouterProvider router={router} />
}
