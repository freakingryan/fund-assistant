/**
 * 投资体检 SOP — 全屏步进向导容器。
 *
 * 复用 useFundDetail() 上下文（须在 FundDetailProvider 子树内渲染），
 * 用 useFundDecision 取融合决策、buildCategoryViews 取九维展示，
 * 全程不重算、不新开路由。最后一步把「评分快照 + 各维度认同度 + 用户决策」存入 IndexedDB。
 *
 * @module components/holdings/guide/DecisionGuide
 */

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { useFundDetail } from "@/hooks/useFundDetailController";
import { useFundDecision } from "@/hooks/useFundDecision";
import { buildCategoryViews } from "@/services/guide/categoryViews";
import { saveDecisionLog } from "@/services/guide/decisionLog";
import { toast } from "@/components/ui/toast";
import type { DecisionLog, FactorVerdict, InvestorDecision, PerFactorVerdict } from "@/types";
import GuideProgress from "./GuideProgress";
import StepRegime from "./StepRegime";
import StepScore from "./StepScore";
import StepForce from "./StepForce";
import StepSignals from "./StepSignals";
import StepJudgment from "./StepJudgment";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STEPS = ["看大环境", "综合评分", "多空力量", "九维信号", "你的判断"];

export default function DecisionGuide({ open, onClose }: Props) {
  const ctrl = useFundDetail();
  const { decision } = useFundDecision({
    klines: ctrl.klineData,
    patterns: ctrl.klineDetectedPatterns,
    signalResult: ctrl.signalResult,
    isRealKline: ctrl.isRealKline,
    em: ctrl.emFactors,
    regime: ctrl.regime,
  });

  const [step, setStep] = useState(0);
  const [perFactor, setPerFactor] = useState<PerFactorVerdict>({});
  const [userDecision, setUserDecision] = useState<InvestorDecision | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // 关闭时重置状态（下次打开是干净的一轮）
  const handleClose = () => {
    setStep(0);
    setPerFactor({});
    setUserDecision(null);
    setReason("");
    onClose();
  };

  const views = useMemo(
    () => buildCategoryViews(ctrl.signalResult, decision, ctrl.emFactors, ctrl.emLoading),
    [ctrl.signalResult, decision, ctrl.emFactors, ctrl.emLoading],
  );

  const isLast = step === STEPS.length - 1;
  const fund = ctrl.fund;

  const handleVerdict = (category: string, v: FactorVerdict) => {
    setPerFactor((prev) => ({ ...prev, [category]: v }));
  };

  const handleSave = async () => {
    if (!fund || !decision || !userDecision) return;
    setSaving(true);
    try {
      const log: DecisionLog = {
        id: `${fund.code}-${Date.now()}`,
        fundCode: fund.code,
        fundName: fund.name || fund.code,
        createdAt: Date.now(),
        asOfDate: ctrl.klineAsOf ? new Date(ctrl.klineAsOf).toISOString().slice(0, 10) : null,
        score: decision.score,
        action: decision.finalAction,
        actionLabel: decision.actionLabel,
        ratingLabel: decision.ratingLabel,
        perFactor,
        decision: userDecision,
        decisionReason: reason.trim(),
        bullRatio: decision.bullRatio,
        lowConfidence: decision.lowConfidence,
      };
      await saveDecisionLog(log);
      toast({ type: "success", message: "已存入你的投资体检档案" });
      handleClose();
    } catch {
      toast({ type: "error", message: "存档失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        showClose={false}
        className="z-[60] flex h-[92vh] w-[95vw] max-w-2xl flex-col gap-0 p-0"
      >
        {/* 头部 */}
        <DialogHeader className="m-0 flex-row items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-sm">投资体检 SOP</DialogTitle>
            <p className="text-[11px] text-muted-foreground truncate">
              {fund ? `${fund.name}（${fund.code}）` : ""} · 第 {step + 1}/{STEPS.length} 步：
              {STEPS[step]}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* 进度 */}
        <div className="border-b border-border px-4 py-2.5">
          <GuideProgress steps={STEPS} current={step} onJump={(i) => i <= step && setStep(i)} />
        </div>

        {/* 主体 */}
        <div
          key={step}
          className="flex-1 animate-in fade-in duration-200 overflow-y-auto px-4 py-3"
        >
          {ctrl.klineLoading ? (
            <div className="flex h-full flex-col items-center justify-center text-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">正在加载行情与评分数据…</p>
            </div>
          ) : !decision ? (
            <div className="flex h-full flex-col items-center justify-center text-center gap-2 py-10">
              <p className="text-sm text-muted-foreground">还没有可用于体检的数据。</p>
              <p className="text-[11px] text-muted-foreground">
                请先在详情页加载 K 线（指数/ETF 真实 K 线最佳），再来做投资体检。
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={handleClose}>
                返回详情页
              </Button>
            </div>
          ) : step === 0 ? (
            <StepRegime
              regime={ctrl.regime}
              em={ctrl.emFactors}
              regimeLoading={ctrl.regimeLoading}
              emLoading={ctrl.emLoading}
            />
          ) : step === 1 ? (
            <StepScore decision={decision} />
          ) : step === 2 ? (
            <StepForce decision={decision} />
          ) : step === 3 ? (
            <StepSignals views={views} perFactor={perFactor} onVerdict={handleVerdict} />
          ) : (
            <StepJudgment
              decision={decision}
              perFactor={perFactor}
              userDecision={userDecision}
              reason={reason}
              onDecisionChange={setUserDecision}
              onReasonChange={setReason}
            />
          )}
        </div>

        {/* 底部导航 */}
        {decision && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              上一步
            </Button>
            {isLast ? (
              <Button size="sm" onClick={handleSave} disabled={!userDecision || saving}>
                {saving ? "存档中…" : "完成并存档"}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                下一步
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
