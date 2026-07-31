import { createBrowserRouter } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/components/dashboard/DashboardPage";
import HoldingsPage from "@/components/holdings/HoldingsPage";
import FundDetailPage from "@/components/holdings/FundDetailPage";
import FundDetailGateway from "@/components/dashboard/FundDetailGateway";
import StockDetailPage from "@/components/holdings/StockDetailPage";
import PlansPage from "@/components/plans/PlansPage";
import PromptsPage from "@/components/prompts/PromptsPage";
import NotificationsPage from "@/components/settings/NotificationsPage";
import SettingsPage from "@/components/settings/SettingsPage";
import DailyReportPage from "@/components/daily/DailyReportPage";
import BacktestPage from "@/components/backtest/BacktestPage";
import RankingPage from "@/components/ranking/RankingPage";
import MarketPage from "@/components/market/MarketPage";
import InsightInputView from "@/components/insights/InsightInputView";
import InsightTimelineView from "@/components/insights/InsightTimelineView";
import InsightBacktestView from "@/components/insights/InsightBacktestView";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "holdings", element: <HoldingsPage /> },
        { path: "detail/:id", element: <FundDetailPage /> },
        { path: "detail", element: <FundDetailGateway /> },
        { path: "stock/:code", element: <StockDetailPage /> },
        { path: "plans", element: <PlansPage /> },
        { path: "prompts", element: <PromptsPage /> },
        { path: "notifications", element: <NotificationsPage /> },
        { path: "backtest", element: <BacktestPage /> },
        { path: "ranking", element: <RankingPage /> },
        { path: "market", element: <MarketPage /> },
        { path: "daily", element: <DailyReportPage /> },
        { path: "insights", element: <InsightInputView /> },
        { path: "insights/timeline", element: <InsightTimelineView /> },
        { path: "insights/backtest", element: <InsightBacktestView /> },
        { path: "settings", element: <SettingsPage /> },
      ],
    },
  ],
  {
    basename: import.meta.env.BASE_URL,
  },
);
