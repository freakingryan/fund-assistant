/**
 * AiAdvisoryPanel — T4 运行时 AI 解释层的通用 UI 容器
 *
 * 被两处复用：
 * - DecisionAdvisorCard 的「AI 综合研判」（T4.1）
 * - KlinePatternCard 的「AI 形态解读」（T4.2）
 *
 * 自持状态：idle → loading → done / error，并区分「未配置 AI」与「调用失败」。
 * 未配置时渲染引导去设置页的 banner（捕获 NoAIConfiguredError）。
 *
 * @module AiAdvisoryPanel
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { NoAIConfiguredError } from "@/services/backtest/aiAnalysis";
import type { AiAdvisoryResult } from "@/services/aiAdvisor";

interface Props {
  /** 触发 AI 解释：返回结果或抛 NoAIConfiguredError */
  run: () => Promise<AiAdvisoryResult>;
  /** 面板标题（如「AI 综合研判」「AI 形态解读」） */
  title: string;
  /** 触发按钮文案（首次） */
  triggerLabel?: string;
}

type PanelState = "idle" | "loading" | "done" | "error";

export function AiAdvisoryPanel({ run, title, triggerLabel = "AI 综合研判" }: Props) {
  const [state, setState] = useState<PanelState>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [needConfig, setNeedConfig] = useState(false);

  async function handleRun() {
    if (state === "loading") return;
    setState("loading");
    setNeedConfig(false);
    setError("");
    try {
      const res = await run();
      if (res.usedAI && res.text) {
        setText(res.text);
        setState("done");
      } else {
        setError(res.error || "AI 返回为空，请重试");
        setState("error");
      }
    } catch (e) {
      if (e instanceof NoAIConfiguredError) {
        setNeedConfig(true);
        setState("error");
      } else {
        setError(e instanceof Error ? e.message : "AI 调用失败");
        setState("error");
      }
    }
  }

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-primary" />
          {title}
        </span>
        {state === "loading" ? (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            研判中…
          </span>
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleRun}>
            <Sparkles className="h-3 w-3 mr-1" />
            {state === "done" ? "重新研判" : triggerLabel}
          </Button>
        )}
      </div>

      {needConfig && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            尚未配置 AI。请到
            <Link to={ROUTES.settings} className="underline mx-1">
              设置页
            </Link>
            配置 AI Provider 与 API Key 后使用本功能。
          </span>
        </div>
      )}

      {state === "done" && text && (
        <div className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-line bg-muted/20 rounded px-2 py-1.5">
          {text}
        </div>
      )}

      {state === "error" && !needConfig && (
        <p className="text-[10px] text-orange-500 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {error || "调用失败，请重试"}
        </p>
      )}
    </div>
  );
}
