import { useFundDetail } from "@/hooks/useFundDetailController";
import { DecisionAdvisorCard } from "@/components/holdings/DecisionAdvisorCard";

/** 基金详情页专属包装：从 FundDetailContext 取数，喂给共享的 DecisionAdvisorCard（个股页仍走 props，不受影响） */
export default function FundDecisionAdvisorCard() {
  const ctrl = useFundDetail();

  return (
    <DecisionAdvisorCard
      klines={ctrl.klineData}
      patterns={ctrl.klineDetectedPatterns}
      signalResult={ctrl.signalResult}
      isRealKline={ctrl.isRealKline}
      em={ctrl.emFactors}
      regime={ctrl.regime}
      asOf={ctrl.klineAsOf}
      fetchedAt={ctrl.klineFetchedAt}
    />
  );
}
