import { Loader2 } from "lucide-react";
import { useRanking } from "@/hooks/useRankingController";
import RankingHeader from "./RankingHeader";
import RankingStats from "./RankingStats";
import MissingFundsCard from "./MissingFundsCard";
import RankingSortControls from "./RankingSortControls";
import RankingTable from "./RankingTable";
import SectorFundFlowPanel from "./SectorFundFlowPanel";

/** 排行榜页布局：仅组合子组件，所有状态/行为来自 useRanking 控制器 */
export default function RankingLayout() {
  const { loading, tab } = useRanking();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RankingHeader />

      {tab === "score" && (
        <>
          <RankingStats />
          <MissingFundsCard />
          <RankingSortControls />
          <RankingTable />
        </>
      )}

      {tab === "flow" && <SectorFundFlowPanel />}
    </div>
  );
}
