import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { memo } from "react";
import { useRanking } from "@/hooks/useRankingController";

interface MissingFundRowProps {
  fund: { code: string; name: string; source: string | null; reason: string };
}

/** 未纳入评分基金行：React.memo 包裹，避免父级重渲时整列重算 */
const MissingFundRow = memo(function ({ fund: m }: MissingFundRowProps) {
  return (
    <li className="text-[11px] flex items-center gap-2 flex-wrap">
      <span className="font-medium truncate max-w-[150px]">{m.name}</span>
      <span className="font-mono text-muted-foreground">{m.code}</span>
      <span
        className={`px-1.5 py-0.5 rounded border text-[10px] ${
          m.source === "eastmoney"
            ? "text-down border-down/30 bg-down/10"
            : m.source === "tencent"
              ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
              : "text-muted-foreground border-border/40"
        }`}
        title={m.reason}
      >
        {m.source === "eastmoney"
          ? "东财不可达"
          : m.source === "tencent"
            ? "腾讯K线失败"
            : "未采集"}
      </span>
      <span className="text-muted-foreground truncate">{m.reason}</span>
    </li>
  );
});

/** 未纳入评分：数据源不可达 / 尚未采集的基金（标注原因） */
export default function MissingFundsCard() {
  const { missingFunds } = useRanking();
  if (missingFunds.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5 text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          未纳入评分（{missingFunds.length} 只）
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[11px] text-muted-foreground mb-2">
          以下基金因数据源不可达或尚未采集，未出现在排名中（不影响已评分基金的排序）：
        </p>
        <ul className="space-y-1">
          {missingFunds.map((m) => (
            <MissingFundRow key={m.code} fund={m} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
