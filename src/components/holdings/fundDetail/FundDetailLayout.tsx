import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useFundDetail } from "@/hooks/useFundDetailController";
import EditFundDialog from "@/components/holdings/EditFundDialog";
import QuickAdjustDialog from "@/components/holdings/QuickAdjustDialog";
import { TechnicalIndicatorsPanel } from "@/components/holdings/TechnicalIndicatorsPanel";
import FundRankHistoryCard from "@/components/holdings/FundRankHistoryCard";
import FundDividendCard from "./FundDividendCard";
import FundKlineChartCard from "./FundKlineChartCard";
import FundKlinePatternCard from "./FundKlinePatternCard";
import FundSignalScoreCard from "./FundSignalScoreCard";
import FundDecisionAdvisorCard from "./FundDecisionAdvisorCard";
import DecisionGuide from "../guide/DecisionGuide";
import ResearchReportCard from "@/components/holdings/ResearchReportCard";
import FundHeader from "./FundHeader";
import HoldingInfoCard from "./HoldingInfoCard";
import FundPortfolioCard from "./FundPortfolioCard";
import PromptAiCard from "./PromptAiCard";

/** 基金详情页布局：仅组合子组件，所有状态/行为来自 useFundDetail 控制器 */
export default function FundDetailLayout() {
  const ctrl = useFundDetail();
  const navigate = useNavigate();
  const { fund } = ctrl;
  const [guideOpen, setGuideOpen] = useState(false);

  if (!fund) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.holdings)}>
          <ArrowLeft className="h-3 w-3 mr-1" />
          返回持仓
        </Button>
        <Card>
          <CardContent className="text-center py-16">
            <p className="text-muted-foreground">基金不存在</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <FundHeader />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-8"
          onClick={() => setGuideOpen(true)}
          title="按 SOP 逐步看懂各项指标并给出自己的判断"
        >
          <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
          投资体检 SOP
        </Button>
      </div>

      <HoldingInfoCard />

      <EditFundDialog fund={fund} open={ctrl.editOpen} onOpenChange={ctrl.setEditOpen} />
      <QuickAdjustDialog fund={fund} open={ctrl.adjustOpen} onOpenChange={ctrl.setAdjustOpen} />

      {/* 智能决策建议：紧随持仓信息，独占整行 */}
      <FundDecisionAdvisorCard />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4">
          <FundKlineChartCard />
          <FundKlinePatternCard />
          <ResearchReportCard stockCode={ctrl.etfCode} stockName={fund.name} />
          <details className="group rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground flex items-center gap-1.5 list-none select-none">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              分析明细（综合评分 / 技术指标 / 形态）
            </summary>
            <div className="mt-3 space-y-4">
              <FundSignalScoreCard />
              <TechnicalIndicatorsPanel klines={ctrl.klineData} />
            </div>
          </details>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          <FundPortfolioCard />
          <FundRankHistoryCard code={fund.code} config={ctrl.eastmoneyConfig} />
          <FundDividendCard code={fund.code} config={ctrl.eastmoneyConfig} />
          <PromptAiCard />
        </div>
      </div>

      {/* 新手投资体检 SOP 向导（全屏步进 overlay，复用 FundDetailProvider 上下文） */}
      <DecisionGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
