import { useFundDetail } from "@/hooks/useFundDetailController";
import KlinePatternCard from "@/components/holdings/KlinePatternCard";

/** 基金详情页专属包装：从 FundDetailContext 取数，喂给共享的 KlinePatternCard（个股页仍走 props，不受影响） */
export default function FundKlinePatternCard() {
  const ctrl = useFundDetail();

  return (
    <KlinePatternCard
      klineData={ctrl.klineData}
      klineDetectedPatterns={ctrl.klineDetectedPatterns}
      klinePatterns={ctrl.klinePatterns}
      klineAnalysis={ctrl.klineAnalysis}
      klineAnalyzing={ctrl.klineAnalyzing}
      klineAnalysisError={ctrl.klineAnalysisError}
      hoveredKlineIndex={ctrl.hoveredKlineIndex}
      selectedKlineIndex={ctrl.selectedKlineIndex}
      onPatternHover={ctrl.setHoveredKlineIndex}
      onPatternSelect={ctrl.handlePatternClick}
      onAnalyzeKline={ctrl.handleAnalyzeKline}
      onGenerateKlinePrompt={ctrl.handleGenerateKlinePrompt}
      isRealKline={ctrl.isRealKline}
      etfCode={ctrl.etfCode}
      loading={ctrl.useEtfKline && ctrl.klineLoading}
      etfKlineError={ctrl.etfKlineError}
      onSwitchToRealKline={() => {
        ctrl.setEtfKlineError(null);
        ctrl.setKlineRefreshKey((k) => k + 1);
        ctrl.setUseEtfKline(true);
      }}
    />
  );
}
