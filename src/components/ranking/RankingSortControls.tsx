import { type ReactNode } from "react";
import { HelpCircle, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useRanking } from "@/hooks/useRankingController";

/** 排序控制区：综合评分 / 资金面分 / 赛道分 / 同类排名 切换（含各维度 tooltip 说明） */
export default function RankingSortControls() {
  const { effectiveSort, hasCapital, hasSector, hasRank, setSortBy, eastmoneyEnabled } =
    useRanking();

  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
          排序：
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 opacity-60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-left leading-relaxed">
              鼠标悬停每个排序按钮，查看其含义与排序方向（前三个分数越高越靠前；同类排名百分位越小越靠前）。
            </TooltipContent>
          </Tooltip>
        </span>
        <SortBtn
          active={effectiveSort === "score"}
          onClick={() => setSortBy("score")}
          desc={
            <>
              <div className="font-semibold mb-0.5">综合评分</div>
              <div>决策引擎技术面综合分（趋势 / 乖离 / 动量 / 量能 / MACD / 形态）。</div>
              <div>
                排序：分数<b className="font-semibold">从高到低</b>
                ，高分=偏买入排前、低分=减仓靠后；同分按资金面分兜底。
              </div>
            </>
          }
        >
          综合评分
        </SortBtn>
        <SortBtn
          active={effectiveSort === "capital"}
          disabled={!hasCapital}
          hint={
            eastmoneyEnabled
              ? "今日快照暂无资金面数据，点「更新今日评分」回填"
              : "开启东财增强后可用"
          }
          onClick={() => hasCapital && setSortBy("capital")}
          desc={
            <>
              <div className="font-semibold mb-0.5">资金面分</div>
              <div>重仓股 / ETF 的主力资金净流入 + 北向资金，加权聚合（0–100）。</div>
              <div>
                排序：分数<b className="font-semibold">从高到低</b>，资金越净流入越靠前。
              </div>
              <div className="opacity-80">需开启东财增强；无数据沉底。</div>
            </>
          }
        >
          资金面分
        </SortBtn>
        <SortBtn
          active={effectiveSort === "sector"}
          disabled={!hasSector}
          hint={
            eastmoneyEnabled ? "今日快照暂无赛道数据，点「更新今日评分」回填" : "开启东财增强后可用"
          }
          onClick={() => hasSector && setSortBy("sector")}
          desc={
            <>
              <div className="font-semibold mb-0.5">赛道分</div>
              <div>重仓股所属行业 + 概念板块当日涨跌幅，按持仓权重加权（0–100）。</div>
              <div>
                排序：分数<b className="font-semibold">从高到低</b>，踩中强势板块排前。
              </div>
              <div className="opacity-80">需开启东财增强；无数据沉底。</div>
            </>
          }
        >
          赛道分
        </SortBtn>
        <SortBtn
          active={effectiveSort === "rank"}
          disabled={!hasRank}
          hint={
            eastmoneyEnabled
              ? "今日快照暂无同类排名数据，点「更新今日评分」回填"
              : "开启东财增强后可用"
          }
          onClick={() => hasRank && setSortBy("rank")}
          desc={
            <>
              <div className="font-semibold mb-0.5">同类排名</div>
              <div>
                东财官方同类近三月排名百分位（0–100，<b className="font-semibold">越小越好</b>
                ）。
              </div>
              <div>
                排序：百分位<b className="font-semibold">从小到大</b>，前 12% 排最前、后 50% 沉底。
              </div>
              <div className="opacity-80">需开启东财增强；无数据沉底。</div>
            </>
          }
        >
          同类排名
        </SortBtn>
      </div>
      {(!hasCapital || !hasSector || !hasRank) && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3" />
          {eastmoneyEnabled
            ? "资金面 / 赛道 / 同类排名暂无数据，点「更新今日评分」回填（已开启东财增强）"
            : "资金面 / 赛道 / 同类排名需到「设置 → 数据源」开启东财增强后才会采集"}
        </p>
      )}
    </div>
  );
}

function SortBtn({
  active,
  disabled,
  hint,
  desc,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  hint?: string;
  desc?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : undefined}
      className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : disabled
            ? "bg-muted/20 text-muted-foreground/50 border-border/30 cursor-not-allowed"
            : "bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted"
      }`}
    >
      {children}
      {desc && <HelpCircle className="h-3 w-3 opacity-60" />}
      {disabled && hint && <span className="ml-0.5 text-[10px] opacity-70">（暂无）</span>}
    </button>
  );
  if (!desc) return btn;
  // 用 span 包裹，确保按钮 disabled 时仍能悬停触发 tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={disabled ? "inline-flex cursor-not-allowed" : "inline-flex"}>{btn}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-left leading-relaxed">
        {desc}
      </TooltipContent>
    </Tooltip>
  );
}
