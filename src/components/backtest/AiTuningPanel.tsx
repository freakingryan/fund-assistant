/**
 * AI 调参反馈可视化面板（T5.4 — 反馈环的人审闭环界面）
 *
 * 三个区块：
 *  1. 当前生效参数：按 PARAM_SCHEMA 分组展示默认值/自定义值，标注「已自定义」并提供「恢复默认」。
 *  2. 待审 AI 提案：getPendingProposal() —— 当前 vs 建议 对比表 + 采纳/拒绝（人审，AI 永不直接改参）。
 *  3. 采纳历史：getAllTuningProposals() —— 状态流转徽章 + 已采纳项一键回滚。
 * 另提供手动「生成 AI 调参提案」入口（generateTuningProposal('manual')）。
 *
 * 安全边界继承自 T5.2：所有数值均经白名单 clamp，UI 只展示 PARAM_SCHEMA 内的叶子。
 *
 * @module backtest/AiTuningPanel
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PARAMS,
  PARAM_SCHEMA,
  getDecisionParams,
  getParamByPath,
  hasDecisionParamsOverride,
} from "@/services/decision/decisionParams";
import {
  adoptTuningProposal,
  AUTO_TUNE_MIN_NEW_SETTLED,
  generateTuningProposal,
  getAllTuningProposals,
  getPendingProposal,
  rejectTuningProposal,
  resetDecisionParamsToDefault,
  rollbackTuningProposal,
} from "@/services/backtest/tuningProposal";
import { getDefaultAI } from "@/services/ai";
import { NoAIConfiguredError } from "@/services/backtest/aiAnalysis";
import type {
  ParamDiffItem,
  ScoreSnapshot,
  TuningProposal,
  TuningProposalStatus,
} from "@/services/backtest/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Sparkles,
  RotateCcw,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

/** 数值格式化：整数原样，小数去掉尾部 0 */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** 方向性准确率格式化为百分比（可选 null） */
function fmtRate(v: number | null): string {
  return v == null ? "-" : `${(v * 100).toFixed(1)}%`;
}

const STATUS_META: Record<TuningProposalStatus, { label: string; cls: string }> = {
  pending: { label: "待审核", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  adopted: { label: "已采纳", cls: "bg-up/10 text-up border-up/30" },
  rejected: { label: "已拒绝", cls: "bg-muted/40 text-muted-foreground border-border/40" },
  rolledBack: { label: "已回滚", cls: "bg-down/10 text-down border-down/30" },
};

/** path → 元信息（标签/范围），用于 diff 渲染 */
const META_BY_PATH = new Map(PARAM_SCHEMA.map((m) => [m.path, m]));

function diffLabel(d: ParamDiffItem): string {
  return META_BY_PATH.get(d.path)?.label ?? d.path;
}

function CurrentParamsBlock({ custom, onChange }: { custom: boolean; onChange: () => void }) {
  // 按 group 分组（保持 PARAM_SCHEMA 顺序）；每次渲染重读 getDecisionParams() 以反映最新生效值
  const params = getDecisionParams();
  const grouped: [string, { path: string; label: string; current: number; def: number }[]][] = [];
  const groupMap = new Map<
    string,
    { path: string; label: string; current: number; def: number }[]
  >();
  for (const m of PARAM_SCHEMA) {
    const current = getParamByPath(params, m.path);
    const def = getParamByPath(DEFAULT_PARAMS, m.path);
    if (current == null || def == null) continue;
    const arr = groupMap.get(m.group) ?? [];
    arr.push({ path: m.path, label: m.label, current, def });
    groupMap.set(m.group, arr);
  }
  for (const [g, arr] of groupMap.entries()) grouped.push([g, arr]);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span>当前生效参数</span>
          {custom ? (
            <span className="px-1.5 py-0.5 rounded border text-[10px] bg-up/10 text-up border-up/30">
              已自定义
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded border text-[10px] bg-muted/40 text-muted-foreground border-border/40">
              默认
            </span>
          )}
        </div>
        {custom && (
          <Button size="sm" variant="ghost" onClick={onChange} className="h-7 px-2 text-[11px]">
            <RotateCcw className="h-3 w-3 mr-1" />
            恢复默认
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
        {grouped.map(([group, leaves]) => (
          <div key={group} className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {group}
            </div>
            {leaves.map((l) => {
              const isCustomLeaf = l.current !== l.def;
              return (
                <div
                  key={l.path}
                  className="flex items-center justify-between text-[11px] leading-tight"
                >
                  <span className="text-muted-foreground truncate">{l.label}</span>
                  <span className="flex items-center gap-1.5 shrink-0 font-mono">
                    <span className={isCustomLeaf ? "text-up font-medium" : "text-foreground"}>
                      {fmtNum(l.current)}
                    </span>
                    {isCustomLeaf && (
                      <span className="text-[9px] text-muted-foreground/70">
                        默认 {fmtNum(l.def)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffTable({ diffs }: { diffs: ParamDiffItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-muted-foreground border-b bg-muted/30">
            <th className="text-left font-medium py-1.5 px-2">参数</th>
            <th className="text-right font-medium py-1.5 px-2">当前</th>
            <th className="text-right font-medium py-1.5 px-2">AI 建议</th>
            <th className="text-left font-medium py-1.5 px-2">理由</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={d.path} className="border-b border-border/30 last:border-0">
              <td className="py-1.5 px-2 text-foreground/90">{diffLabel(d)}</td>
              <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                {fmtNum(d.current)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono font-medium text-up">
                {fmtNum(d.proposed)}
              </td>
              <td className="py-1.5 px-2 text-muted-foreground leading-snug max-w-[220px]">
                {d.reason || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingProposalCard({
  proposal,
  onAdopt,
  onReject,
  busy,
}: {
  proposal: TuningProposal;
  onAdopt: () => void;
  onReject: () => void;
  busy: "adopt" | "reject" | null;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const s = proposal.statsSummary;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3 w-3 text-amber-500" />
          <span>待审核 AI 调参提案</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            {proposal.trigger === "auto" ? "自动触发" : "手动生成"} · {proposal.provider}/
            {proposal.model}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            onClick={onAdopt}
            disabled={busy !== null || proposal.diffs.length === 0}
            className="h-7"
          >
            {busy === "adopt" ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Check className="h-3 w-3 mr-1" />
            )}
            采纳
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={busy !== null}
            className="h-7"
          >
            {busy === "reject" ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <X className="h-3 w-3 mr-1" />
            )}
            拒绝
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="px-1.5 py-0.5 rounded bg-muted/40">已结算 {s.settled}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/40">
          方向性 {fmtRate(s.directionalAccuracy)}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-muted/40">买入命中 {fmtRate(s.buyHitRate)}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/40">卖出命中 {fmtRate(s.sellHitRate)}</span>
        {proposal.droppedCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-down/10 text-down border-down/30">
            丢弃 {proposal.droppedCount} 条非法建议
          </span>
        )}
      </div>

      {proposal.diffs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          AI 未提出任何有效调整
          {proposal.expectedImpact
            ? `：${proposal.expectedImpact}`
            : "（可能样本不足或证据不充分）。"}
        </p>
      ) : (
        <>
          <DiffTable diffs={proposal.diffs} />
          {proposal.expectedImpact && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              预期影响：{proposal.expectedImpact}
            </p>
          )}
        </>
      )}

      <button
        onClick={() => setRawOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {rawOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {rawOpen ? "收起原始返回" : "查看原始返回"}
      </button>
      {rawOpen && (
        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words bg-background/60 rounded p-2 max-h-48 overflow-auto">
          {proposal.raw}
        </pre>
      )}
    </div>
  );
}

function HistoryCard({
  p,
  onRollback,
  busy,
}: {
  p: TuningProposal;
  onRollback: () => void;
  busy: boolean;
}) {
  const meta = STATUS_META[p.status];
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${meta.cls}`}>
            {meta.label}
          </span>
          <span className="text-muted-foreground">{p.date}</span>
          <span className="text-[10px] text-muted-foreground">
            {p.trigger === "auto" ? "自动" : "手动"} · {p.provider}/{p.model}
          </span>
        </div>
        {p.status === "adopted" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRollback}
            disabled={busy}
            className="h-6 px-2 text-[10px]"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            回滚
          </Button>
        )}
      </div>
      {p.diffs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {p.diffs.map((d) => (
            <span
              key={d.path}
              className="px-1.5 py-0.5 rounded border text-[10px] bg-background/50 border-border/40 font-mono"
            >
              {diffLabel(d)} {fmtNum(d.current)}→{fmtNum(d.proposed)}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">无参数调整</p>
      )}
    </div>
  );
}

export default function AiTuningPanel({ snapshots }: { snapshots: ScoreSnapshot[] }) {
  const [pending, setPending] = useState<TuningProposal | null>(null);
  const [history, setHistory] = useState<TuningProposal[]>([]);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState<null | "generate" | "adopt" | "reject" | "rollback" | "reset">(
    null,
  );

  const aiConfigured = useMemo(() => {
    const ai = getDefaultAI();
    return !!(ai && ai.apiKey);
  }, []);

  const reload = useCallback(async () => {
    // 全部 setState 置于 await 之后：避免 effect 同步 setState（react-hooks/set-state-in-effect）
    try {
      const [pend, hist] = await Promise.all([getPendingProposal(), getAllTuningProposals()]);
      setPending(pend);
      setHistory(hist);
    } catch {
      setPending(null);
      setHistory([]);
    }
    setCustom(hasDecisionParamsOverride());
  }, []);

  // 初始加载 + 父级快照变化时同步（采纳/拒绝/回滚后也手动 reload）
  useEffect(() => {
    void reload(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [snapshots, reload]);

  const handleGenerate = async () => {
    if (busy) return;
    setBusy("generate");
    try {
      const proposal = await generateTuningProposal(snapshots, "manual");
      toast({
        type: "success",
        message:
          proposal.diffs.length > 0
            ? `已生成调参提案（${proposal.diffs.length} 条建议待审核）`
            : "已生成提案，但 AI 未提出有效调整",
      });
      await reload();
    } catch (e) {
      if (e instanceof NoAIConfiguredError) {
        toast({ type: "error", message: e.message });
      } else {
        toast({ type: "error", message: e instanceof Error ? e.message : "生成提案失败" });
      }
    }
    setBusy(null);
  };

  const handleAdopt = async (id: string) => {
    setBusy("adopt");
    try {
      await adoptTuningProposal(id);
      toast({ type: "success", message: "已采纳并即时生效" });
      await reload();
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "采纳失败" });
    }
    setBusy(null);
  };

  const handleReject = async (id: string) => {
    setBusy("reject");
    try {
      await rejectTuningProposal(id);
      toast({ type: "info", message: "已拒绝该提案" });
      await reload();
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "拒绝失败" });
    }
    setBusy(null);
  };

  const handleRollback = async (id: string) => {
    setBusy("rollback");
    try {
      await rollbackTuningProposal(id);
      toast({ type: "success", message: "已回滚到采纳前参数" });
      await reload();
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "回滚失败" });
    }
    setBusy(null);
  };

  const handleReset = async () => {
    setBusy("reset");
    try {
      await resetDecisionParamsToDefault();
      toast({ type: "info", message: "已恢复全部默认参数" });
      await reload();
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "恢复默认失败" });
    }
    setBusy(null);
  };

  const settled = useMemo(
    () =>
      snapshots.filter(
        (s) => s.outcome === "correct" || s.outcome === "wrong" || s.outcome === "neutral",
      ).length,
    [snapshots],
  );

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI 调参反馈环
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            disabled={busy !== null || snapshots.length === 0}
          >
            {busy === "generate" ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            生成 AI 调参提案
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!aiConfigured && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            未配置 AI（设置页填写 API Key 后，方可生成/自动触发调参提案）。
          </div>
        )}
        {settled === 0 && snapshots.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            尚无已回填数据，调参建议证据有限；建议先积累若干交易日快照。
          </div>
        )}

        {/* 区块 1：当前生效参数 */}
        <CurrentParamsBlock custom={custom} onChange={handleReset} />

        {/* 区块 2：待审提案 */}
        {pending ? (
          <PendingProposalCard
            proposal={pending}
            onAdopt={() => handleAdopt(pending.id)}
            onReject={() => handleReject(pending.id)}
            busy={busy === "adopt" || busy === "reject" ? (busy as "adopt" | "reject") : null}
          />
        ) : (
          <p className="text-xs text-muted-foreground text-center py-3">
            暂无待审核提案。点击「生成 AI 调参提案」或等待自动触发（累计新增{" "}
            {AUTO_TUNE_MIN_NEW_SETTLED} 条已结算样本 / 每 7 天）。
          </p>
        )}

        {/* 区块 3：采纳历史 */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            采纳历史
            <span className="text-[10px] font-normal">（状态流转 = 审计轨迹）</span>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">暂无调参历史记录</p>
          ) : (
            <div className="space-y-1.5 max-h-[360px] overflow-auto">
              {history.map((p) => (
                <HistoryCard
                  key={p.id}
                  p={p}
                  onRollback={() => handleRollback(p.id)}
                  busy={busy === "rollback"}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
