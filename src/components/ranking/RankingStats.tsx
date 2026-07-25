import { Card, CardContent } from "@/components/ui/card";
import { useRanking } from "@/hooks/useRankingController";

/** 评分概览统计卡：纳入排名 / 建议买入 / 建议减仓 / 平均评分 */
export default function RankingStats() {
  const { stats } = useRanking();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="纳入排名" value={`${stats.total}`} sub="只基金" />
      <Stat label="建议买入" value={`${stats.buy}`} sub="评分靠前" up />
      <Stat label="建议减仓" value={`${stats.sell}`} sub="评分靠后" down />
      <Stat label="平均评分" value={`${stats.avg}`} sub={`持有 ${stats.hold} · 中性`} highlight />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
  up,
  down,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  up?: boolean;
  down?: boolean;
}) {
  return (
    <Card className="card-hover">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <p
          className={`text-xl font-bold tracking-tight ${
            highlight ? "text-primary" : up ? "text-up" : down ? "text-down" : ""
          }`}
        >
          {value}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
