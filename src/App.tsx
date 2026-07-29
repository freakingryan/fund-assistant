import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useEffect, useState, Component } from "react";
import { useHoldingsStore } from "./stores/holdings";
import { useSettingsStore } from "./stores/settings";
import { usePlansStore } from "./stores/plans";
import { useNotificationsStore } from "./stores/notifications";
import { runDailyGistPush } from "./services/autoSync";
import {
  captureDailySnapshots,
  reconcileSnapshots,
  backfillMissingTradingDays,
  isFundDataReady,
  localDateKey,
  getAllSnapshots,
} from "./services/backtest/decisionSnapshot";
import { maybeAutoTune } from "./services/backtest/tuningProposal";
import { isTradingDay } from "./lib/tradingCalendar";
import { requestNotificationPermission } from "./services/notification";
import { registerServiceWorker } from "./services/pwa/registerSW";
import { ensurePeriodicSync } from "./services/pwa/periodicSync";
import { notify } from "./services/notify";
import { isMarketOpen } from "@/services/marketStatus";
import ToastContainer from "./components/ui/toast";
import InstallPrompt from "./components/layout/InstallPrompt";
import { AlertCircle } from "lucide-react";
import { Button } from "./components/ui/button";

// #29: ErrorBoundary — 防止某组件崩溃导致整个 App 白屏
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-center space-y-3 p-8">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
            <h2 className="text-lg font-semibold">应用出现异常</h2>
            <p className="text-sm text-muted-foreground">
              请刷新页面重试，或清除浏览器数据后重新加载。
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
            >
              刷新页面
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 交易时段判定复用 marketStatus 模块（isMarketOpen）。
 * 原本地 isTradingHoursOpen 已迁移，避免重复实现与午休/周末边界差异。
 */

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
/**
 * T5.3 自动调参触发（静默、幂等）：回填结算后检查是否满足
 * 「新增已结算样本 ≥20 或 距上次提案 ≥7 天」，满足则生成待审提案（绝不自动采纳），
 * 并推一条应用内通知引导人审。AI 未配置 / 已有待审提案时静默跳过。
 */
async function autoTuneCheck() {
  try {
    const snapshots = await getAllSnapshots();
    const proposal = await maybeAutoTune(snapshots);
    if (proposal && proposal.diffs.length > 0) {
      notify({
        type: "info",
        title: "AI 调参提案待审核",
        body: `基于 ${proposal.statsSummary.settled} 条已结算回测样本生成了 ${proposal.diffs.length} 条参数调整建议，请前往回测页审核。`,
        channels: ["inApp"],
      });
    }
  } catch (e) {
    console.warn("[tuning] 自动调参检查失败", e);
  }
}

let backtestBackfillRan = false;
async function autoCaptureBacktestOnce() {
  const today = localDateKey();
  const meta = useSettingsStore.getState().settings.backtest;
  // 今日采集（每日首次守卫）：仅基金数据公布后（工作日 ≥20:00，净值定稿）自动采一次，
  // 避免盘后早期（15:00–20:00）采到“昨日净值”当作今日基准；盘中/未到 20:00 不采且不锁当日。
  if (isTradingDay(new Date()) && meta?.lastAutoCaptureDate !== today) {
    if (isFundDataReady()) {
      await captureDailySnapshots(); // force=false，遵守收盘门禁（≥15:00 已满足）
      await useSettingsStore.getState().updateBacktestMeta({ lastAutoCaptureDate: today });
    }
  }
  // 回溯补齐最近缺失的交易日（仅本次会话首次运行一次）
  if (!backtestBackfillRan) {
    backtestBackfillRan = true;
    await backfillMissingTradingDays(7);
  }
}

export default function App() {
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadPlan = usePlansStore((s) => s.loadPlan);
  const theme = useSettingsStore((s) => s.settings.theme);
  const [systemDark, setSystemDark] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // 监听系统暗色偏好
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Phase 6.5: 暗色模式 + 通知权限
  useEffect(() => {
    const isDark = theme === "dark" || (theme === "system" && systemDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, [theme, systemDark]);

  // 浏览器通知权限请求
  useEffect(() => {
    if (theme !== null && "Notification" in window && Notification.permission === "default") {
      // 只在用户启用浏览器通知时请求
      const notif = useSettingsStore.getState().settings.notifications.channels.includes("browser");
      if (notif) Notification.requestPermission();
    }
  }, [theme]);

  // 初始化数据
  useEffect(() => {
    const init = async () => {
      await loadSettings();
      // 注册自定义 Service Worker（production 构建），提供 PWA 离线外壳；
      // 是否真正周期后台扫描由设置项 backgroundScan 在 SW 内决定。
      registerServiceWorker();
      // 若用户已开启后台定时扫描，确保周期同步任务已注册。
      if (useSettingsStore.getState().settings.notifications.backgroundScan) {
        ensurePeriodicSync().catch((e) => console.warn("[App] 周期后台同步注册失败", e));
      }
      await loadHoldings();
      await loadPlan();
      await useNotificationsStore.getState().loadNotifications();
      runDailyGistPush();

      // 收盘前自动扫描：交易时段内打开 App 即跑一次投资计划检查，新提醒推送浏览器通知。
      // scan() 内部按 fundCode|ruleId 去重，仅生成真正新增的提醒，不会重复打扰。
      if (isMarketOpen()) {
        const plan = usePlansStore.getState().plan;
        if (plan?.enabled) {
          const holdings = useHoldingsStore.getState().holdings;
          if (holdings.length > 0) {
            try {
              const newAlerts = await usePlansStore.getState().scan(holdings);
              if (newAlerts.length > 0) {
                await requestNotificationPermission();
                newAlerts.forEach((a) =>
                  notify({
                    type: "warning",
                    title: `计划提醒 · ${a.fundName}`,
                    body: a.reason,
                    channels: ["browser", "feishu"],
                  }),
                );
              }
            } catch (e) {
              console.warn("[plans] 收盘前自动扫描失败", e);
            }
          }
        }
      }
      // 评分回测：收盘后自动补采当日快照（每日首次守卫）+ 回填次日涨跌（幂等，门禁内置）
      autoCaptureBacktestOnce().catch((e) => console.warn("[backtest] 自动采集失败", e));
      // 回填结算后串联 T5.3 自动调参检查（用最新 settled 计数判定触发）
      reconcileSnapshots()
        .catch((e) => console.warn("[backtest] 自动回填失败", e))
        .then(() => autoTuneCheck());
    };
    init();
  }, [loadSettings, loadHoldings, loadPlan]);

  // 每日自动同步：每 6 小时复查一次（长会话跨过 24h 窗口也能触发，间隔与失败退避对齐）
  useEffect(() => {
    const timer = setInterval(
      () => {
        runDailyGistPush();
      },
      6 * 60 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);

  // 评分回测：每 30 分钟复查一次采集/回填（仅收盘后/已有次日数据时生效，幂等）
  useEffect(() => {
    const timer = setInterval(
      () => {
        autoCaptureBacktestOnce().catch((e) => console.warn("[backtest] 定时采集失败", e));
        reconcileSnapshots()
          .catch((e) => console.warn("[backtest] 定时回填失败", e))
          .then(() => autoTuneCheck());
      },
      30 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <InstallPrompt />
      <ToastContainer />
    </ErrorBoundary>
  );
}
