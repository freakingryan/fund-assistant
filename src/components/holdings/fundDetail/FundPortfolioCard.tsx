import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshButton } from "@/components/ui/refresh-button";
import DataAsOf from "@/components/ui/DataAsOf";
import { Loader2, ChevronRight } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useFundDetail } from "@/hooks/useFundDetailController";

/** 重仓股（持仓穿透）卡片：消费详情控制器，依赖 fund/portfolio 状态 */
export default function FundPortfolioCard() {
  const {
    fund,
    portfolio,
    portfolioLoading,
    portfolioAsOf,
    portfolioFetchedAt,
    handleRefreshPortfolio,
    refreshing,
  } = useFundDetail();
  const navigate = useNavigate();
  if (!fund) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">重仓股</CardTitle>
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              前 10 大
            </span>
          </div>
          <RefreshButton
            onClick={handleRefreshPortfolio}
            loading={refreshing.portfolio}
            title="刷新重仓股"
            label="刷新"
          />
        </div>
      </CardHeader>
      <CardContent>
        {portfolioLoading ? (
          <div className="flex items-center justify-center h-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : portfolio && portfolio.holdings.length > 0 ? (
          <div className="space-y-2">
            <DataAsOf asOf={portfolioAsOf} fetchedAt={portfolioFetchedAt} inline />
            <div className="space-y-1">
              {portfolio.holdings.map((h, i) => (
                <div
                  key={h.code}
                  onClick={() => navigate(ROUTES.stock(h.code))}
                  className="group flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/40 cursor-pointer transition-colors"
                  title="查看个股详情"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground w-4 text-right">
                      {i + 1}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{h.code}</span>
                    <span className="truncate group-hover:text-foreground">{h.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`font-mono font-medium ${h.ratio >= 5 ? "text-red-500" : ""}`}>
                      {h.ratio.toFixed(1)}%
                    </span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">暂无重仓股数据</p>
        )}
      </CardContent>
    </Card>
  );
}
