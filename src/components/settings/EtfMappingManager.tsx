import { useState, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, Pencil, Search, RefreshCw, Loader2, X, Wand2,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useHoldingsStore } from '@/stores/holdings'
import { dataSourceService } from '@/adapters/datasource/service'
import { fetchEtfMapping, fetchEtfMappings } from '@/services/ai'
import { toast } from '@/components/ui/toast'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { EtfMapping } from '@/types'

// 场内 ETF 代码段（沪/深/京），这类基金本身即可交易、无需映射到另一个场内 ETF
const EXCHANGE_ETF_PREFIX = /^(51|159|56|58|16)/

interface Draft {
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
}

const emptyDraft: Draft = { otcCode: '', otcName: '', exchangeCode: '', exchangeName: '' }

type Row =
  | { kind: 'holding'; code: string; name: string; mapping: EtfMapping | null; mappingIndex: number | null }
  | { kind: 'orphan'; code: string; name: string; mapping: EtfMapping; mappingIndex: number }

export default function EtfMappingManager() {
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const addEtfMapping = useSettingsStore((s) => s.addEtfMapping)
  const updateEtfMapping = useSettingsStore((s) => s.updateEtfMapping)
  const removeEtfMapping = useSettingsStore((s) => s.removeEtfMapping)
  const holdings = useHoldingsStore((s) => s.holdings)

  const [open, setOpen] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<{ exchangeCode: string; exchangeName: string }[]>([])
  const [refreshing, setRefreshing] = useState<number | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })

  // 合并：所有持仓 + 持仓中不存在的孤儿映射
  const rows = useMemo<Row[]>(() => {
    const mapByCode = new Map<string, { m: EtfMapping; i: number }>()
    etfMappings.forEach((m, i) => { if (!mapByCode.has(m.otcCode)) mapByCode.set(m.otcCode, { m, i }) })
    const result: Row[] = []
    const seen = new Set<string>()
    for (const h of holdings) {
      seen.add(h.code)
      const hit = mapByCode.get(h.code)
      result.push({ kind: 'holding', code: h.code, name: h.name, mapping: hit?.m ?? null, mappingIndex: hit?.i ?? null })
    }
    // 孤儿映射（otcCode 不在当前持仓中）
    for (const m of etfMappings) {
      if (seen.has(m.otcCode)) continue
      const hit = mapByCode.get(m.otcCode)
      if (hit) result.push({ kind: 'orphan', code: m.otcCode, name: m.otcName, mapping: m, mappingIndex: hit.i })
    }
    return result
  }, [holdings, etfMappings])

  const unmappedCount = useMemo(
    () => rows.filter((r) => r.kind === 'holding' && !r.mapping && !EXCHANGE_ETF_PREFIX.test(r.code) && /^\d{6}$/.test(r.code)).length,
    [rows],
  )

  const openAdd = () => {
    setDraft(emptyDraft)
    setEditIndex(null)
    setCandidates([])
    setOpen(true)
  }

  const openAddFromHolding = (code: string, name: string) => {
    setDraft({ otcCode: code, otcName: name, exchangeCode: '', exchangeName: '' })
    setEditIndex(null)
    setCandidates([])
    setOpen(true)
  }

  const openEdit = (index: number) => {
    const m = etfMappings[index]
    if (!m) return
    setDraft({ ...m })
    setEditIndex(index)
    setCandidates([])
    setOpen(true)
  }

  const closeDialog = () => {
    setOpen(false)
    setEditIndex(null)
    setDraft(emptyDraft)
    setCandidates([])
  }

  // 按场内 ETF 名称/代码搜索候选（复用数据源搜索兜底）
  const handleSearch = useCallback(async () => {
    const keyword = (draft.otcName || draft.otcCode).trim()
    if (!keyword) {
      toast({ type: 'warning', message: '请先填写场外基金名称或代码' })
      return
    }
    setSearching(true)
    setCandidates([])
    try {
      const results = await dataSourceService.searchStocks(keyword)
      const etfs = results
        .map((r: any) => ({ exchangeCode: String(r.code || '').replace(/^(SZ|SH)/, ''), exchangeName: String(r.name || '') }))
        .filter((r) => /^(\d{6})$/.test(r.exchangeCode) && /^(159|51|56|58|16)/.test(r.exchangeCode))
      if (etfs.length > 0) {
        setCandidates(etfs)
      } else {
        toast({ type: 'info', message: '未搜到场内 ETF，可尝试「自动匹配」或手动填写' })
      }
    } catch {
      toast({ type: 'error', message: '搜索失败，请手动填写场内 ETF 代码' })
    }
    setSearching(false)
  }, [draft.otcCode, draft.otcName])

  // 按场外代码自动匹配（数据源 → AI 兜底）
  const handleAutoMatch = useCallback(async () => {
    const code = draft.otcCode.trim()
    if (!code) {
      toast({ type: 'warning', message: '请先填写场外基金代码' })
      return
    }
    setSearching(true)
    try {
      const result = await fetchEtfMapping(code)
      if (result?.exchangeCode) {
        setDraft((d) => ({
          ...d,
          otcName: d.otcName || result.otcName || code,
          exchangeCode: result.exchangeCode,
          exchangeName: result.exchangeName || result.exchangeCode,
        }))
        setCandidates([])
        toast({ type: 'success', message: `自动匹配到：${result.exchangeCode} ${result.exchangeName}` })
      } else {
        toast({ type: 'info', message: '未自动匹配到，可手动填写或搜索' })
      }
    } catch {
      toast({ type: 'error', message: '自动匹配失败，请手动填写' })
    }
    setSearching(false)
  }, [draft.otcCode])

  const handleSave = () => {
    if (!draft.otcCode.trim()) { toast({ type: 'warning', message: '场外基金代码必填' }); return }
    if (!draft.exchangeCode.trim()) { toast({ type: 'warning', message: '场内 ETF 代码必填' }); return }
    const payload: EtfMapping = {
      otcCode: draft.otcCode.trim(),
      otcName: draft.otcName.trim() || draft.otcCode.trim(),
      exchangeCode: draft.exchangeCode.trim(),
      exchangeName: draft.exchangeName.trim() || draft.exchangeCode.trim(),
    }
    if (editIndex === null) {
      addEtfMapping(payload.otcCode, payload.otcName, payload.exchangeCode, payload.exchangeName)
      toast({ type: 'success', message: '已新增 ETF 映射' })
    } else {
      updateEtfMapping(editIndex, payload)
      toast({ type: 'success', message: '已更新 ETF 映射' })
    }
    closeDialog()
  }

  const handleDelete = (index: number) => {
    const m = etfMappings[index]
    if (!m) return
    removeEtfMapping(index)
    toast({ type: 'success', message: `已删除映射：${m.otcCode} → ${m.exchangeCode}` })
  }

  const handleRefresh = async (index: number) => {
    const m = etfMappings[index]
    if (!m) return
    setRefreshing(index)
    try {
      const result = await fetchEtfMapping(m.otcCode)
      if (result?.exchangeCode) {
        updateEtfMapping(index, {
          otcCode: result.otcCode || m.otcCode,
          otcName: result.otcName || m.otcName,
          exchangeCode: result.exchangeCode,
          exchangeName: result.exchangeName || result.exchangeCode,
        })
        toast({ type: 'success', message: `已刷新：${result.exchangeCode} ${result.exchangeName}` })
      } else {
        toast({ type: 'info', message: `${m.otcCode} 未找到可更新的场内 ETF` })
      }
    } catch {
      toast({ type: 'error', message: `刷新失败：${m.otcCode}` })
    }
    setRefreshing(null)
  }

  const pickCandidate = (c: { exchangeCode: string; exchangeName: string }) => {
    setDraft((d) => ({ ...d, exchangeCode: c.exchangeCode, exchangeName: c.exchangeName }))
    setCandidates([])
  }

  // 批量补全：对所有「未映射的场外基金」串行查询并写入
  const handleBatchResolve = useCallback(async () => {
    const targets = rows
      .filter((r): r is Extract<Row, { kind: 'holding' }> =>
        r.kind === 'holding' && !r.mapping && !EXCHANGE_ETF_PREFIX.test(r.code) && /^\d{6}$/.test(r.code))
      .map((r) => r.code)
    if (targets.length === 0) {
      toast({ type: 'info', message: '没有需要补全的未映射场外基金' })
      return
    }
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: targets.length })
    try {
      const { found, missing } = await fetchEtfMappings(targets, {
        onProgress: (done, total) => setBatchProgress({ done, total }),
      })
      for (const m of found) {
        await addEtfMapping(m.otcCode, m.otcName, m.exchangeCode, m.exchangeName)
      }
      toast({
        type: found.length > 0 ? 'success' : 'info',
        message: `批量补全完成：新增 ${found.length} 条映射${
          missing.length > 0 ? `，${missing.length} 条未找到（可手动添加）` : ''
        }`,
      })
    } catch {
      toast({ type: 'error', message: '批量补全失败' })
    } finally {
      setBatchRunning(false)
    }
  }, [rows, addEtfMapping])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">场内 ETF 映射</CardTitle>
            <CardDescription>
              覆盖全部 {holdings.length} 只持仓；场外基金可关联场内 ETF 用于实时行情与 K 线
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" className="h-7 text-xs" variant="outline"
              onClick={handleBatchResolve} disabled={batchRunning || unmappedCount === 0}
              title="对所有未映射的场外基金自动查询场内 ETF"
            >
              {batchRunning
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />补全中 {batchProgress.done}/{batchProgress.total}</>
                : <><Wand2 className="h-3 w-3 mr-1" />批量补全未映射{unmappedCount > 0 ? ` (${unmappedCount})` : ''}</>}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={openAdd}>
              <Plus className="h-3 w-3 mr-1" />新增映射
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            暂无持仓。导入持仓或新增基金会自动建立映射，也可在此手动添加。
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[88px]">代码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[72px]">类型</TableHead>
                  <TableHead className="w-[88px]">场内ETF</TableHead>
                  <TableHead>场内名称</TableHead>
                  <TableHead className="w-[76px]">状态</TableHead>
                  <TableHead className="w-[120px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isEtf = r.kind !== 'orphan' && EXCHANGE_ETF_PREFIX.test(r.code)
                  const typeBadge = r.kind === 'orphan'
                    ? <Badge variant="outline" className="text-[10px]">映射(无持仓)</Badge>
                    : isEtf
                      ? <Badge variant="outline" className="text-[10px]">场内ETF</Badge>
                      : <Badge variant="secondary" className="text-[10px]">场外基金</Badge>
                  const statusBadge = isEtf
                    ? <Badge variant="secondary" className="text-[10px] text-muted-foreground">无需映射</Badge>
                    : r.mapping
                      ? <Badge variant="secondary" className="text-[10px] text-green-600">已映射</Badge>
                      : <Badge variant="destructive" className="text-[10px]">未映射</Badge>
                  return (
                    <TableRow key={`${r.kind}-${r.code}`}>
                      <TableCell className="text-xs font-mono">{r.code}</TableCell>
                      <TableCell className="text-xs">{r.name}</TableCell>
                      <TableCell>{typeBadge}</TableCell>
                      <TableCell className="text-xs font-mono">{r.mapping ? r.mapping.exchangeCode : '-'}</TableCell>
                      <TableCell className="text-xs">{r.mapping ? r.mapping.exchangeName : '-'}</TableCell>
                      <TableCell>{statusBadge}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {isEtf ? (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          ) : r.mapping ? (
                            <>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                title="重新查询"
                                disabled={refreshing === r.mappingIndex}
                                onClick={() => r.mappingIndex !== null && handleRefresh(r.mappingIndex)}
                              >
                                {refreshing === r.mappingIndex
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <RefreshCw className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                title="编辑"
                                onClick={() => r.mappingIndex !== null && openEdit(r.mappingIndex)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="删除"
                                onClick={() => r.mappingIndex !== null && handleDelete(r.mappingIndex)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => openAddFromHolding(r.code, r.name)}
                            >
                              <Plus className="h-3 w-3 mr-1" />添加映射
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editIndex === null ? '新增 ETF 映射' : '编辑 ETF 映射'}</DialogTitle>
            <DialogDescription>填写场外基金与其对应的场内 ETF 代码</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">场外基金代码 *</Label>
                <Input
                  value={draft.otcCode}
                  onChange={(e) => setDraft((d) => ({ ...d, otcCode: e.target.value }))}
                  placeholder="如 023765"
                  className="text-xs font-mono h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">场外基金名称</Label>
                <Input
                  value={draft.otcName}
                  onChange={(e) => setDraft((d) => ({ ...d, otcName: e.target.value }))}
                  placeholder="如 华夏中证5G通信主题ETF联接D"
                  className="text-xs h-8"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">场内 ETF 代码 *</Label>
                <Input
                  value={draft.exchangeCode}
                  onChange={(e) => setDraft((d) => ({ ...d, exchangeCode: e.target.value }))}
                  placeholder="如 515050"
                  className="text-xs font-mono h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">场内 ETF 名称</Label>
                <Input
                  value={draft.exchangeName}
                  onChange={(e) => setDraft((d) => ({ ...d, exchangeName: e.target.value }))}
                  placeholder="如 通信ETF华夏"
                  className="text-xs h-8"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs h-8" onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                搜索场内ETF
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-8" onClick={handleAutoMatch} disabled={searching}>
                {searching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                自动匹配
              </Button>
            </div>

            {candidates.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-auto">
                <p className="text-[10px] text-muted-foreground px-2 py-1">点击选择候选：</p>
                {candidates.map((c) => (
                  <button
                    key={c.exchangeCode}
                    type="button"
                    onClick={() => pickCandidate(c)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 text-left"
                  >
                    <span className="font-mono">{c.exchangeCode}</span>
                    <span className="truncate ml-2 flex-1">{c.exchangeName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={closeDialog}>
              <X className="h-3 w-3 mr-1" />取消
            </Button>
            <Button size="sm" onClick={handleSave}>
              {editIndex === null ? '新增' : '保存'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
