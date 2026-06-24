import { useEffect, useState, useMemo, useCallback } from 'react'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { useSettingsStore } from '@/stores/settings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Copy, Sparkles, RefreshCw, CheckCircle, AlertCircle, FileText,
} from 'lucide-react'
import { generatePrompt, type PromptTemplateType } from '@/services/prompt'

const TEMPLATE_OPTIONS: { value: PromptTemplateType; label: string; desc: string }[] = [
  { value: 'diagnostic', label: '持仓诊断', desc: '分析持仓结构、风险收益、给出综合建议' },
  { value: 'rebalance', label: '调仓建议', desc: '结合投资计划提醒，给出调仓操作建议' },
  { value: 'kline_enhanced', label: 'K 线增强', desc: '针对有场内 ETF 映射的基金，补充 K 线技术面分析' },
]

export default function PromptsPage() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const alerts = usePlansStore((s) => s.alerts)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [templateType, setTemplateType] = useState<PromptTemplateType>('diagnostic')
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [generated, setGenerated] = useState(false)

  useEffect(() => {
    loadHoldings()
    loadAlerts()
  }, [loadHoldings, loadAlerts])

  // 获取实时行情（复用计划引擎已有的行情加载）
  // 用 quotesMap 原始对象避免 unstable 引用导致无限重渲染
  const quotesMap = useHoldingsStore((s) => s.quotes)
  const quotes = useMemo(() => Object.values(quotesMap), [quotesMap])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(holdings.map((h) => h.id)))
  }, [holdings])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleGenerate = useCallback(() => {
    if (selectedIds.size === 0) return
    const result = generatePrompt({
      templateType,
      holdings,
      quotes,
      selectedIds: Array.from(selectedIds),
      etfMappings,
      alerts,
    })
    setPrompt(result)
    setGenerated(true)
    setCopied(false)
  }, [templateType, holdings, quotes, selectedIds, etfMappings, alerts])

  const handleCopy = useCallback(async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [prompt])

  const selectedCount = selectedIds.size

  if (holdings.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prompt 生成器</h1>
          <p className="text-sm text-muted-foreground mt-1">选择持仓基金，一键生成 AI 投资分析 Prompt</p>
        </div>
        <Card>
          <CardContent className="text-center py-16 space-y-3">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground">暂无持仓数据，请先在「持仓管理」中添加基金</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prompt 生成器</h1>
        <p className="text-sm text-muted-foreground mt-1">
          选择持仓基金和模板，一键生成可复制的 AI 投资分析 Prompt
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Controls */}
        <div className="lg:col-span-2 space-y-4">
          {/* Holdings selection */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">选择持仓</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-1"
                    onClick={selectAll}>全选</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-1"
                    onClick={clearSelection}>清空</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="max-h-64 overflow-auto space-y-0.5">
              {holdings.map((h) => (
                <label key={h.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer text-xs">
                  <Checkbox
                    checked={selectedIds.has(h.id)}
                    onCheckedChange={() => toggleSelect(h.id)}
                  />
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{h.code}</span>
                  <span className="truncate flex-1">{h.name || h.code}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          {/* Template selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">模板选择</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {TEMPLATE_OPTIONS.map((opt) => {
                const active = templateType === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTemplateType(opt.value)}
                    className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                      active
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        active ? 'border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {active && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                      </div>
                      <span className={`text-xs font-medium ${active ? 'text-primary' : ''}`}>{opt.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 ml-5">{opt.desc}</p>
                  </button>
                )
              })}

              <Separator />

              <Button
                className="w-full"
                size="sm"
                disabled={selectedCount === 0}
                onClick={handleGenerate}
              >
                <Sparkles className="h-3 w-3 mr-2" />
                生成 Prompt（{selectedCount} 只基金）
              </Button>
            </CardContent>
          </Card>

          {/* ETF mapping info */}
          {templateType === 'kline_enhanced' && (
            <Card>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-1 text-xs font-medium">
                  <AlertCircle className="h-3 w-3" /> ETF 映射状态
                </div>
                {etfMappings.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    当前无映射。可在「设置 → ETF 映射」中添加，用于补充 K 线分析。
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    已配置 {etfMappings.length} 条映射。选中持仓中{' '}
                    {holdings.filter((h) => etfMappings.some((m) => m.otcCode === h.code) && selectedIds.has(h.id)).length}
                    {' '}只基金有对应的场内 ETF。
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Prompt preview */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Prompt 预览</CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs"
                    disabled={!generated}
                    onClick={handleGenerate}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />重新生成
                  </Button>
                  <Button
                    variant="default" size="sm" className="h-7 text-xs"
                    disabled={!prompt}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <><CheckCircle className="h-3 w-3 mr-1 text-green-300" />已复制</>
                    ) : (
                      <><Copy className="h-3 w-3 mr-1" />复制</>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!generated ? (
                <div className="text-center py-12 space-y-2">
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {selectedCount > 0
                      ? `已选 ${selectedCount} 只基金，点击「生成」创建 Prompt`
                      : '先在左侧勾选需要分析的基金'}
                  </p>
                </div>
              ) : (
                <Textarea
                  value={prompt}
                  readOnly
                  className="min-h-[400px] text-xs font-mono leading-relaxed"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
