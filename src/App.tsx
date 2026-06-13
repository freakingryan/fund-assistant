import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useEffect } from 'react'
import { useHoldingsStore } from './stores/holdings'
import { useSettingsStore } from './stores/settings'
import { usePlansStore } from './stores/plans'

export default function App() {
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadPlans = usePlansStore((s) => s.loadPlans)

  useEffect(() => {
    loadSettings()
    loadHoldings()
    loadPlans()
  }, [loadSettings, loadHoldings, loadPlans])

  return <RouterProvider router={router} />
}
