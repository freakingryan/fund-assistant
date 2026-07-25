import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import DataAsOf from "@/components/ui/DataAsOf";
import { Wallet, TrendingUp, Pencil, CheckCircle, Loader2 } from "lucide-react";
import { useFundDetail } from "@/hooks/useFundDetailController";
import { pnlColor, formatSigned } from "@/lib/format";
import { resolveHoldingCost } from "@/lib/holdingCost";
import type { ReactNode } from "react";

/** 持仓信息卡：成本/市值/收益率等，依赖实时行情与成本解析（消费详情控制器） */
export default function HoldingInfoCard() {
  const {
    fund,
    valuations,
    quotesAsOf,
    quotesFetchedAt,
    handleRefreshQuotes,
    refreshing,
    setAdjustOpen,
    setEditOpen,
    capturingScore,
    handleCaptureScore,
  } = useFundDetail();

  if (!fund) return null;
  const val = valuations[fund.code];
  const q = val?.quote;
  // 有效净值必须 > 1 且不是默认值 1.0000
  const currentNAV = q?.nav && q.nav > 0.001 && q.nav !== 1 ? q.nav : null;

  // 统一成本解析（兼容方式一/方式二；方式二按当前净值反算份额与成本净值）
  const {
    costValue: investment,
    costNAV,
    shares: activeShares,
    method,
  } = resolveHoldingCost(fund, currentNAV || 0);

  // 当前市值 = 份额 × 最新净值（优先），否则用持有金额，最后用成本
  const currentMarketValue =
    activeShares && currentNAV ? activeShares * currentNAV : fund.holdingAmount || investment || 0;

  const profit = currentMarketValue - investment;
  const returnRate = investment > 0 ? (profit / investment) * 100 : 0;
  const isProfit = profit >= 0;

  const navPrefix = method === "stored" ? "¥" : "≈¥";
  const shareDisplay =
    activeShares > 0
      ? method === "stored"
        ? activeShares.toLocaleString()
        : `≈${activeShares.toLocaleString()}`
      : "-";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" />
            持仓信息
          </CardTitle>
          <div className="flex items-center gap-2">
            <RefreshButton
              onClick={handleRefreshQuotes}
              loading={refreshing.quotes}
              title="刷新行情"
              label="刷新行情"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAdjustOpen(true)}
            >
              <TrendingUp className="h-3 w-3 mr-1 text-green-500" />
              调仓
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCaptureScore}
              disabled={capturingScore}
            >
              {capturingScore ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  记录今日评分
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3 w-3 mr-1" />
              编辑
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Item label="持有份额" value={shareDisplay} />
            <Item
              label="持仓成本单价"
              value={costNAV > 0 ? `${navPrefix}${costNAV.toFixed(4)}` : "-"}
            />
            <Item
              label="最新净值"
              value={
                <>
                  {currentNAV ? `¥${currentNAV.toFixed(4)}` : "-"}
                  {q?.dailyChange != null && currentNAV && (
                    <span className={`ml-1 text-[10px] ${pnlColor(q.dailyChange)}`}>
                      {formatSigned(q.dailyChange)}
                      {q.dailyChange.toFixed(2)}%
                    </span>
                  )}
                </>
              }
            />
            <Item label="投入本金" value={investment ? `¥${investment.toFixed(2)}` : "-"} />
            <Item
              label="当前市值"
              value={currentMarketValue ? `¥${currentMarketValue.toFixed(2)}` : "-"}
            />
            <Item
              label="浮动盈亏"
              value={profit ? `${formatSigned(profit)}¥${profit.toFixed(2)}` : "-"}
              className={pnlColor(isProfit)}
            />
            <Item
              label="收益率"
              value={investment > 0 ? `${isProfit ? "+" : ""}${returnRate.toFixed(2)}%` : "-"}
              className={pnlColor(isProfit)}
            />
            <Item label="购买日期" value={fund.purchaseDate || "-"} />
          </div>
          <DataAsOf asOf={quotesAsOf} fetchedAt={quotesFetchedAt} />
        </div>
      </CardContent>
    </Card>
  );
}

/** 持仓信息项 */
function Item({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${className}`}>{value}</p>
    </div>
  );
}
