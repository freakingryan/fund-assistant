import { useFundDetail } from "@/hooks/useFundDetailController";
import KlineChartCard from "@/components/holdings/KlineChartCard";

/** 基金详情页专属包装：从 FundDetailContext 取数，喂给共享的 KlineChartCard（个股页仍走 props，不受影响） */
export default function FundKlineChartCard() {
  const ctrl = useFundDetail();
  const etfQuote = ctrl.etfCode ? ctrl.valuations[ctrl.etfCode]?.quote || null : null;

  return (
    <KlineChartCard
      klineData={ctrl.klineData}
      klineLoading={ctrl.klineLoading}
      asOf={ctrl.klineAsOf}
      fetchedAt={ctrl.klineFetchedAt}
      etfCode={ctrl.etfCode}
      etfQuote={etfQuote}
      onRefreshQuote={ctrl.handleRefreshQuotes}
      quoteRefreshing={ctrl.refreshing.quotes}
      useEtfKline={ctrl.useEtfKline}
      setUseEtfKline={ctrl.setUseEtfKline}
      period={ctrl.period}
      setPeriod={ctrl.setPeriod}
      showMA={ctrl.showMA}
      setShowMA={ctrl.setShowMA}
      showBollinger={ctrl.showBollinger}
      setShowBollinger={ctrl.setShowBollinger}
      refreshing={ctrl.refreshing}
      handleRefreshKline={ctrl.handleRefreshKline}
      klineDetectedPatterns={ctrl.klineDetectedPatterns}
      onHover={ctrl.setHoveredKlineIndex}
      externalHighlightIndex={ctrl.effectiveKlineHighlight}
      onCandleClick={ctrl.handlePatternClick}
      etfKlineError={ctrl.etfKlineError}
    />
  );
}
