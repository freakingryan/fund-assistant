/**
 * 回测 AI 辅助分析面板
 * - 「AI 分析算法」按钮：把当前全部回测统计喂给已配置的 LLM，诊断薄弱环节 + 调参建议
 * - 分析结果落库可回看，列出历史记录（含结论/薄弱点/建议/原始返回），可删除
 * - 未配置 AI 时给出明确引导
 *
 * @module backtest/AiAnalysisPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { analyzeBacktestWithAI, buildBacktestAnalysisPrompt, deleteAiAnalysis, getAllAiAnalyses, NoAIConfiguredError } from '@/services/backtest/aiAnalysis'
import { computeBacktestStats, computeDailyAccuracySeries } from '@/services/backtest/stats'
import type { AiBacktestAnalysis, ScoreSnapshot } from '@/services/backtest/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, Trash2, ChevronDown, ChevronUp, AlertTriangle, Copy, Check } from 'lucide-react'
import { toast } from '@/components/ui/toast'

function Chip({ children, tone }: { children: React.ReactNode; tone: 'weak' | 'suggest' }) {
  const cls = tone === 'weak'
    ? 'bg-down/10 text-down border-down/30'
    : 'bg-up/10 text-up border-up/30'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] leading-tight ${cls}`}>
      {children}
    </span>
  )
}

function AnalysisCard({ a, onDelete }: { a: AiBacktestAnalysis; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const hasContent = a.weaknesses.length > 0 || a.suggestions.length > 0

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>{a.date}</span>
            <span className="text-[10px] text-muted-foreground font-normal">{a.provider}/{a.model}</span>
          </div>
          {a.summary && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{a.summary}</p>}
        </div>
        <button
          onClick={() => onDelete(a.id)}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
          title="删除此分析"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {!hasContent && (
        <p className="text-[10px] text-muted-foreground">AI 未返回结构化结论（可能样本不足），可展开查看原始返回。</p>
      )}

      {hasContent && (
        <div className="flex flex-wrap gap-1">
          {a.weaknesses.map((w, i) => <Chip key={`w${i}`} tone="weak">{w}</Chip>)}
          {a.suggestions.map((s, i) => <Chip key={`s${i}`} tone="suggest">{s}</Chip>)}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? '收起原始返回' : '查看原始返回'}
      </button>
      {open && (
        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words bg-background/60 rounded p-2 max-h-48 overflow-auto">
{a.raw}
        </pre>
      )}
    </div>
  )
}

export default function AiAnalysisPanel({ snapshots }: { snapshots: ScoreSnapshot[] }) {
  const [analyses, setAnalyses] = useState<AiBacktestAnalysis[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [promptText, setPromptText] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const reload = useCallback(async () => {
    try {
      setAnalyses(await getAllAiAnalyses())
    } catch {
      setAnalyses([])
    }
  }, [])

  useEffect(() => { reload().catch(() => {}) }, [reload]) // eslint-disable-line react-hooks/set-state-in-effect

  const settled = useMemo(
    () => snapshots.filter((s) => s.outcome === 'correct' || s.outcome === 'wrong' || s.outcome === 'neutral').length,
    [snapshots],
  )

  const handleAnalyze = async () => {
    if (analyzing) return
    setAnalyzing(true)
    try {
      const result = await analyzeBacktestWithAI(snapshots)
      toast({ type: 'success', message: `AI 分析完成（${result.date}）` })
      await reload()
    } catch (e) {
      if (e instanceof NoAIConfiguredError) {
        toast({ type: 'error', message: e.message })
      } else {
        toast({ type: 'error', message: e instanceof Error ? e.message : 'AI 分析失败' })
      }
    }
    setAnalyzing(false)
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteAiAnalysis(id)
      await reload()
    } catch {
      toast({ type: 'error', message: '删除失败' })
    }
  }

  /** 仅生成结构化 Prompt（不调用 LLM），复制到剪贴板并展示，便于粘贴到任意 AI 对话 */
  const handleGeneratePrompt = useCallback(() => {
    const stats = computeBacktestStats(snapshots)
    const daily = computeDailyAccuracySeries(snapshots)
    const prompt = buildBacktestAnalysisPrompt(stats, daily, snapshots)
    setPromptText(prompt)
    setPromptOpen(true)
    setCopied(false)
    navigator.clipboard?.writeText(prompt).then(
      () => { setCopied(true); toast({ type: 'success', message: 'Prompt 已复制到剪贴板' }) },
      () => toast({ type: 'error', message: '复制失败，请手动选择文本复制' }),
    )
  }, [snapshots])

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />AI 辅助算法分析
          </CardTitle>
          <Button size="sm" variant="outline" onClick={handleGeneratePrompt} disabled={snapshots.length === 0}>
            <Copy className="h-3 w-3 mr-1" />
            生成 Prompt
          </Button>
          <Button size="sm" variant="default" onClick={handleAnalyze} disabled={analyzing || snapshots.length === 0}>
            {analyzing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            AI 分析算法
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {settled === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            尚无已回填数据，AI 诊断意义有限；建议先积累若干交易日快照。
          </div>
        )}
        {analyses.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            暂无 AI 分析记录，点击「AI 分析算法」基于当前 {snapshots.length} 条快照生成诊断
          </p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-auto">
            {analyses.map((a) => (
              <AnalysisCard key={a.id} a={a} onDelete={handleDelete} />
            ))}
          </div>
        )}
        {promptText && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setPromptOpen((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {promptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {promptOpen ? '收起 Prompt' : '查看 Prompt'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(promptText).then(
                    () => { setCopied(true); toast({ type: 'success', message: 'Prompt 已复制' }) },
                    () => toast({ type: 'error', message: '复制失败，请手动复制' }),
                  )
                }}
                className="flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            {promptOpen && (
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words bg-background/60 rounded p-2 max-h-64 overflow-auto">
{promptText}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
