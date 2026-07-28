import { RankingProvider } from "@/hooks/useRankingController";
import RankingLayout from "./RankingLayout";

/**
 * 综合评分排行榜（路由组件）。
 * 仅做「包裹控制器 Provider」，所有状态/行为由 useRankingController 承担，
 * 布局与子区块由 RankingLayout / RankingTable 组合（控制器见 useRankingController）。
 */
export default function RankingPage() {
  return (
    <RankingProvider>
      <RankingLayout />
    </RankingProvider>
  );
}
