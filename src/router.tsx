import { createBrowserRouter } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import DashboardPage from '@/components/dashboard/DashboardPage'
import HoldingsPage from '@/components/holdings/HoldingsPage'
import FundDetailPage from '@/components/holdings/FundDetailPage'
import PlansPage from '@/components/plans/PlansPage'
import PromptsPage from '@/components/prompts/PromptsPage'
import NotificationsPage from '@/components/settings/NotificationsPage'
import SettingsPage from '@/components/settings/SettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'holdings', element: <HoldingsPage /> },
      { path: 'holdings/:id', element: <FundDetailPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'prompts', element: <PromptsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
