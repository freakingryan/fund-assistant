import { useFundDetail } from "@/hooks/useFundDetailController";
import SignalScoreCard from "@/components/holdings/SignalScoreCard";

/** 基金详情页专属包装：从 FundDetailContext 取数，喂给共享的 SignalScoreCard（个股页仍走 props，不受影响） */
export default function FundSignalScoreCard() {
  const ctrl = useFundDetail();

  return (
    <SignalScoreCard
      signalResult={ctrl.signalResult}
      showSignalDetail={ctrl.showSignalDetail}
      setShowSignalDetail={ctrl.setShowSignalDetail}
      isRealKline={ctrl.isRealKline}
    />
  );
}
