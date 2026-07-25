import { Trophy, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRanking } from "@/hooks/useRankingController";

/** 排行榜页头：标题 + 今日覆盖 + 采集/重评按钮 + 视图 Tab 切换 */
export default function RankingHeader() {
  const { coverage, busy, handleCapture, handleForceRefresh, tab, setTab } = useRanking();

  return (
    <>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> 排行榜
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            基金评分（决策引擎综合分排序，买入靠前、减仓靠后）与全市场板块资金流排行，用上方 Tab
            切换视图
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                coverage.missing === 0 ? "bg-up" : "bg-amber-500"
              }`}
            />
            今日已评 {coverage.covered}/{coverage.total}
          </span>
          {tab === "score" && (
            <>
              <Button size="sm" variant="outline" onClick={handleCapture} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Camera className="h-3 w-3 mr-1" />
                )}
                更新今日评分
                {coverage.missing > 0 && `（补 ${coverage.missing}）`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleForceRefresh}
                disabled={busy}
                title="忽略缓存，重新拉取并覆盖全部持仓今日评分"
              >
                重评全部
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab 切换：基金评分 / 资金流 */}
      <div className="flex items-center gap-1 border-b border-border/50">
        {(["score", "flow"] as const).map((tk) => (
          <button
            key={tk}
            onClick={() => setTab(tk)}
            className={`text-sm px-3 py-1.5 border-b-2 -mb-px transition-colors ${
              tab === tk
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tk === "score" ? "基金评分" : "资金流"}
          </button>
        ))}
      </div>
    </>
  );
}
