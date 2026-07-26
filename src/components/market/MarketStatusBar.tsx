/**
 * 市场状态条（全局护栏可视化）
 *
 * 展示当前 A 股交易时段状态 + 本地日期；非交易时段显示下一交易时段倒计时。
 * 复用 marketStatus 模块的 useMarketStatus（纯时间计算，30s 刷新）。
 *
 * 配色遵循项目惯例：交易中=涨红(up)、休市=跌绿(down)、其余=中性。
 *
 * @module market/MarketStatusBar
 */

import { Clock } from "lucide-react";
import { useMarketStatus, MARKET_STATUS_TONE } from "@/services/marketStatus";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtCountdown(target: Date): string {
  const diff = Math.max(0, target.getTime() - Date.now());
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

export default function MarketStatusBar() {
  const { status, label, isOpen, nextOpenAt } = useMarketStatus();
  const tone = MARKET_STATUS_TONE[status];
  const dot = tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-muted-foreground/50";
  const text = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className={`text-sm font-medium ${text}`}>{label}</span>
        <span className="text-xs text-muted-foreground truncate">{localDate(new Date())}</span>
      </div>
      {isOpen ? (
        <span className="shrink-0 text-xs text-up">交易中 · 实时推送正常</span>
      ) : (
        nextOpenAt && (
          <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              下一交易时段 {fmtTime(nextOpenAt)}（约 {fmtCountdown(nextOpenAt)}）
            </span>
          </div>
        )
      )}
    </div>
  );
}
