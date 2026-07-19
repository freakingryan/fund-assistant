import { useState, useCallback, useMemo } from 'react'
import { Loader2, Wand2, AlertTriangle } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { recommendFundCodeFixes } from '@/services/fundCodeRepair'
import type { FundCodeRepairSuggestion } from '@/services/fundCodeRepair'
import { toast } from '@/components/ui/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function FundCodeRepair() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const updateHolding = useHoldingsStore((s) => s.updateHolding)

  const [detecting, setDetecting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [suggestions, setSuggestions] = useState<FundCodeRepairSuggestion[]>([])
  const [editRecs, setEditRecs] = useState<Record<string, { code: string; name: string }>>({})
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [reviewOpen, setReviewOpen] = useState(false)

  const handleDetect = useCallback(async () => {
    if (holdings.length === 0) {
      toast({ type: 'info', message: '暂无持仓' })
      return
    }
    setDetecting(true)
    setApplied(new Set())
    setSuggestions([])
    setProgress({ done: 0, total: holdings.length })
    try {
      const results = await recommendFundCodeFixes(
        holdings.map((h) => ({ id: h.id, name: h.name, code: h.code })),
        { onProgress: (d, t) => setProgress({ done: d, total: t }), delayMs: 300 },
      )
      setSuggestions(results)
      setEditRecs(
        Object.fromEntries(results.map((r) => [r.id, { code: r.suggestedCode, name: r.suggestedName }])),
      )
      setReviewOpen(true)
      if (results.length === 0) {
        toast({ type: 'success', message: '检测完成：所有持仓的代码与名称均匹配' })
      } else {
        toast({ type: 'warning', message: `检测到 ${results.length} 只持仓代码/名称可能不匹配` })
      }
    } catch {
      toast({ type: 'error', message: '检测失败' })
    } finally {
      setDetecting(false)
    }
  }, [holdings])

  const handleApply = (id: string) => {
    const edit = editRecs[id]
    const sug = suggestions.find((s) => s.id === id)
    if (!edit || !sug) return
    updateHolding(id, { code: edit.code.trim(), name: edit.name.trim() || sug.name })
    setApplied((prev) => new Set(prev).add(id))
    toast({ type: 'success', message: `已修复：${sug.currentCode} → ${edit.code.trim()}` })
  }

  const handleApplyAll = () => {
    let n = 0
    for (const s of suggestions) {
      const edit = editRecs[s.id]
      if (!edit) continue
      updateHolding(s.id, { code: edit.code.trim(), name: edit.name.trim() || s.name })
      n++
    }
    setApplied(new Set(suggestions.map((s) => s.id)))
    setReviewOpen(false)
    toast({ type: 'success', message: `已应用 ${n} 条代码修复` })
  }

  // 已应用的记录排到末尾（未应用的保持原有相对顺序）
  const ordered = useMemo(
    () => [...suggestions].sort((a, b) => {
      const aa = applied.has(a.id)
      const bb = applied.has(b.id)
      return aa === bb ? 0 : aa ? 1 : -1
    }),
    [suggestions, applied],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">按名称修复基金代码</CardTitle>
            <CardDescription>
              针对「导入截图只识别到名称、代码错配」的情况，按基金名称反查权威接口（东财）获取正确代码，审阅后应用。
            </CardDescription>
          </div>
          <Button
            size="sm" className="h-7 text-xs"
            variant="outline"
            onClick={handleDetect}
            disabled={detecting || holdings.length === 0}
          >
            {detecting
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />检测中 {progress.done}/{progress.total}</>
              : <><Wand2 className="h-3 w-3 mr-1" />按名称检测代码不匹配</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {suggestions.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              已检测到 {suggestions.length} 只持仓的代码/名称可能不匹配（表内已按建议值预填，可编辑后应用）。
            </span>
          </div>
        )}
      </CardContent>

      <Dialog open={reviewOpen} onOpenChange={(v) => { if (!v) setReviewOpen(false) }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>按名称修复基金代码（请审阅后应用）</DialogTitle>
            <DialogDescription>
              主路径为东财 FundSearch 接口（权威、已验证）；接口无结果时由 AI 推测并标记为「未验证」，请重点核对。
              确认无误后点「应用」，可手动修改建议代码/名称。
            </DialogDescription>
          </DialogHeader>

          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">未检测到需要修复的持仓</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>基金名称</TableHead>
                    <TableHead className="w-[84px]">当前码</TableHead>
                    <TableHead className="w-[104px]">建议代码</TableHead>
                    <TableHead>建议名称</TableHead>
                    <TableHead className="w-[96px]">来源/置信</TableHead>
                    <TableHead className="w-[64px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordered.map((s) => {
                    const edit = editRecs[s.id] || { code: s.suggestedCode, name: s.suggestedName }
                    const isApplied = applied.has(s.id)
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs">{s.name}</TableCell>
                        <TableCell className="text-xs font-mono text-destructive">{s.currentCode}</TableCell>
                        <TableCell>
                          <Input
                            value={edit.code}
                            onChange={(e) =>
                              setEditRecs((prev) => ({ ...prev, [s.id]: { ...edit, code: e.target.value } }))
                            }
                            className="text-xs font-mono h-7 w-[92px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={edit.name}
                            onChange={(e) =>
                              setEditRecs((prev) => ({ ...prev, [s.id]: { ...edit, name: e.target.value } }))
                            }
                            className="text-xs h-7"
                          />
                        </TableCell>
                        <TableCell className="text-[10px]">
                          <div>
                            {s.source === 'api'
                              ? <Badge variant="secondary" className="text-[10px] text-green-600">接口·已验证</Badge>
                              : <Badge variant="destructive" className="text-[10px]">AI·未验证</Badge>}
                          </div>
                          <div className="text-muted-foreground mt-0.5">置信 {(s.confidence * 100).toFixed(0)}%</div>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm" className="h-7 text-xs"
                            onClick={() => handleApply(s.id)}
                            disabled={isApplied}
                          >
                            {isApplied ? '已应用' : '应用'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setReviewOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleApplyAll} disabled={suggestions.length === 0}>
              全部应用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
