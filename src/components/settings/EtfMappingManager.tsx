import { useState, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, Pencil, Search, RefreshCw, Loader2, X, Wand2, AlertTriangle,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useHoldingsStore } from '@/stores/holdings'
import { dataSourceService } from '@/adapters/datasource/service'
import { fetchEtfMapping, fetchEtfMappings, recommendEtfMappingFix } from '@/services/ai'
import type { EtfMappingRecommendation } from '@/services/ai'
import { detectBrokenEtfMappings } from '@/services/etfMappingHealth'
import type { EtfMappingHealth } from '@/services/etfMappingHealth'
import { useEtfHealthStore } from '@/stores/etfHealth'
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
import { isOnExchangeEtfFund } from '@/lib/fundCategory'

// 场内 ETF 代码段（这类持仓本身就是可交易品种，无需再做场外→场内映射）
const EXCHANGE_ETF_PREFIX = /^(51|159|56|58|16)/
const OTC_CODE = /^\d{6}$/

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

// 主动型：名称未含 ETF/指数（如普通主动股票/混合基金）；其余归为「场内 ETF 类」。
// 复用 fundCategory 的 isOnExchangeEtfFund 作为唯一分类来源。
function isActiveRow(r: Row): boolean {
  return !isOnExchangeEtfFund(r.name)
}

function ruleLabel(rule: EtfMappingRecommendation['rule']): string {
  switch (rule) {
    case 'same_company_same_index':
      return '同公司同指数'
    case 'same_index_diff_company':
      return '同指数跨公司'
    case 'theme_related':
      return '仅主题相关'
    default:
      return '未知'
  }
}

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

  // ETF 映射健康检测 + AI 推荐修复
  const [health, setHealth] = useState<EtfMappingHealth[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectProgress, setDetectProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [recommendations, setRecommendations] = useState<EtfMappingRecommendation[]>([])
  const [recommending, setRecommending] = useState(false)
  const [recProgress, setRecProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [editRecs, setEditRecs] = useState<Record<string, { code: string; name: string }>>({})
  // 已应用的场外码集合：应用后按钮禁用，且记录移到末尾
  const [appliedCodes, setAppliedCodes] = useState<Set<string>>(new Set())

  // 合并：所有持仓（附其映射状态）+ 持仓中不存在的孤儿映射
  const rows = useMemo<Row[]>(() => {
    const mapByCode = new Map<string, { m: EtfMapping; i: number }>()
    etfMappings.forEach((m, i) => {
      if (!mapByCode.has(m.otcCode)) mapByCode.set(m.otcCode, { m, i })
    })
    const seen = new Set<string>()
    const result: Row[] = []
    for (const h of holdings) {
      seen.add(h.code)
      const hit = mapByCode.get(h.code)
      result.push({ kind: 'holding', code: h.code, name: h.name, mapping: hit?.m ?? null, mappingIndex: hit?.i ?? null })
    }
    for (const m of etfMappings) {
      if (seen.has(m.otcCode)) continue
      const idx = mapByCode.get(m.otcCode)?.i ?? -1
      result.push({ kind: 'orphan', code: m.otcCode, name: m.otcName, mapping: m, mappingIndex: idx })
    }
    // 主动型（名称未含 ETF/指数）排到末尾，并用分界线隔开
    const primary = result.filter((r) => !isActiveRow(r))
    const active = result.filter((r) => isActiveRow(r))
    return [...primary, ...active]
  }, [holdings, etfMappings])

  const unmappedCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.kind === 'holding' &&
          !r.mapping &&
          !EXCHANGE_ETF_PREFIX.test(r.code) &&
          OTC_CODE.test(r.code) &&
          !isActiveRow(r),
      ).length,
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
        .filter((r) => OTC_CODE.test(r.exchangeCode) && EXCHANGE_ETF_PREFIX.test(r.exchangeCode))
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
      const result = await fetchEtfMapping(code, draft.otcName)
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
      const result = await fetchEtfMapping(m.otcCode, m.otcName)
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

  const handleBatchResolve = useCallback(async () => {
    const targets = rows
      .filter(
        (r) =>
          r.kind === 'holding' &&
          !r.mapping &&
          !EXCHANGE_ETF_PREFIX.test(r.code) &&
          OTC_CODE.test(r.code) &&
          !isActiveRow(r),
      )
      .map((r) => (r.kind === 'holding' ? r.code : ''))
      .filter(Boolean)
    if (targets.length === 0) {
      toast({ type: 'info', message: '没有需要补全的未映射场外基金' })
      return
    }
    // 收集名称，便于日志与 AI 兜底携带上下文
    const names: Record<string, string> = {}
    for (const r of rows) if (r.kind === 'holding') names[r.code] = r.name
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: targets.length })
    try {
      const { found, missing } = await fetchEtfMappings(targets, {
        onProgress: (done, total) => setBatchProgress({ done, total }),
        names,
      })
      for (const m of found) {
        await addEtfMapping(m.otcCode, m.otcName, m.exchangeCode, m.exchangeName)
      }
      toast({
        type: found.length > 0 ? 'success' : 'info',
        message: `批量补全完成：新增 ${found.length} 条映射${missing.length > 0 ? `，${missing.length} 条未找到` : ''}`,
      })
    } catch {
      toast({ type: 'error', message: '批量补全失败' })
    } finally {
      setBatchRunning(false)
    }
  }, [rows, addEtfMapping])

  const pickCandidate = (c: { exchangeCode: string; exchangeName: string }) => {
    setDraft((d) => ({ ...d, exchangeCode: c.exchangeCode, exchangeName: c.exchangeName }))
    setCandidates([])
  }

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

  // 检测「K 线端点取数失败」的映射（映射错误）；正常项走缓存、不重复检测
  const handleDetect = useCallback(async () => {
    if (etfMappings.length === 0) {
      toast({ type: 'info', message: '暂无映射可检测' })
      return
    }
    setDetecting(true)
    setDetectProgress({ done: 0, total: etfMappings.length })
    try {
      const result = await detectBrokenEtfMappings(etfMappings, {
        onProgress: (d, t) => setDetectProgress({ done: d, total: t }),
      })
      setHealth(result.all)
      if (result.broken.length === 0) {
        toast({ type: 'success', message: `检测完成：全部 ${result.healthy.length} 条映射 K 线均可正常取数` })
      } else {
        toast({ type: 'warning', message: `检测到 ${result.broken.length} 条映射 K 线取数失败` })
      }
    } catch {
      toast({ type: 'error', message: '检测失败' })
    } finally {
      setDetecting(false)
    }
  }, [etfMappings])

  // 对检测到的错误映射，逐条调用 AI 推荐修正项（R1-R4 + 流动性预排序 + K 线验证）
  const handleAiFix = useCallback(async () => {
    setAppliedCodes(new Set())
    const brokenList = (health ? health.filter((h) => !h.ok) : []).map((h) => ({
      otcCode: h.otcCode,
      otcName: h.otcName,
      exchangeCode: h.exchangeCode,
      exchangeName: h.exchangeName,
    }))
    if (brokenList.length === 0) {
      toast({ type: 'info', message: '没有检测到错误的映射，无需修复' })
      return
    }
    setRecommending(true)
    setRecProgress({ done: 0, total: brokenList.length })
    const recs: EtfMappingRecommendation[] = []
    for (let i = 0; i < brokenList.length; i++) {
      const rec = await recommendEtfMappingFix(brokenList[i])
      if (rec) recs.push(rec)
      setRecProgress({ done: i + 1, total: brokenList.length })
      await wait(300)
    }
    setRecommendations(recs)
    setEditRecs(
      Object.fromEntries(
        recs.map((r) => [r.otcCode, { code: r.recommendedExchangeCode, name: r.recommendedExchangeName }]),
      ),
    )
    setRecommending(false)
    setReviewOpen(true)
    const failed = brokenList.length - recs.length
    toast({
      type: recs.length > 0 ? 'success' : 'error',
      message: `AI 推荐完成：${recs.length} 条有建议${failed > 0 ? `，${failed} 条 AI 未给出` : ''}`,
    })
  }, [health])

  const handleApplyRec = (otcCode: string) => {
    const edit = editRecs[otcCode]
    const rec = recommendations.find((r) => r.otcCode === otcCode)
    if (!edit || !rec) return
    const idx = etfMappings.findIndex((m) => m.otcCode === otcCode)
    if (idx < 0) {
      toast({ type: 'error', message: `未找到映射 ${otcCode}` })
      return
    }
    updateEtfMapping(idx, {
      otcCode,
      otcName: rec.otcName,
      exchangeCode: edit.code.trim(),
      exchangeName: edit.name.trim() || edit.code.trim(),
    })
    setAppliedCodes((prev) => new Set(prev).add(otcCode))
    // 仅当 AI 验证通过才记为健康；否则保留为错误待复查
    useEtfHealthStore.getState().set(edit.code.trim(), rec.verified)
    setHealth((prev) =>
      prev
        ? prev.map((h) =>
            h.otcCode === otcCode
              ? { ...h, exchangeCode: edit.code.trim(), exchangeName: edit.name.trim(), ok: rec.verified }
              : h,
          )
        : prev,
    )
    toast({ type: 'success', message: `已更新 ${otcCode} → ${edit.code.trim()}` })
  }

  const handleApplyAll = () => {
    const otcCodes = Object.keys(editRecs)
    if (otcCodes.length === 0) return
    let applied = 0
    for (const otcCode of otcCodes) {
      const edit = editRecs[otcCode]
      const rec = recommendations.find((r) => r.otcCode === otcCode)
      const idx = etfMappings.findIndex((m) => m.otcCode === otcCode)
      if (!edit || !rec || idx < 0) continue
      updateEtfMapping(idx, {
        otcCode,
        otcName: rec.otcName,
        exchangeCode: edit.code.trim(),
        exchangeName: edit.name.trim() || edit.code.trim(),
      })
      useEtfHealthStore.getState().set(edit.code.trim(), rec.verified)
      applied++
    }
    setHealth((prev) =>
      prev
        ? prev.map((h) => {
            const edit = editRecs[h.otcCode]
            const rec = recommendations.find((r) => r.otcCode === h.otcCode)
            return edit && rec
              ? { ...h, exchangeCode: edit.code.trim(), exchangeName: edit.name.trim(), ok: rec.verified }
              : h
          })
        : prev,
    )
    setAppliedCodes(new Set(Object.keys(editRecs)))
    setReviewOpen(false)
    toast({ type: 'success', message: `已应用 ${applied} 条推荐映射` })
  }

  // 检测结果为「K 线失败」的 exchangeCode 集合，用于表格红标
  const brokenCodes = useMemo(
    () => new Set((health || []).filter((h) => !h.ok).map((h) => h.exchangeCode)),
    [health],
  )

  // AI 推荐审查：已应用的记录排到末尾（未应用的保持原有相对顺序）
  const orderedRecs = useMemo(
    () => [...recommendations].sort((a, b) => {
      const aa = appliedCodes.has(a.otcCode)
      const bb = appliedCodes.has(b.otcCode)
      return aa === bb ? 0 : aa ? 1 : -1
    }),
    [recommendations, appliedCodes],
  )

  const renderRow = (r: Row) => {
    const isEtf = r.kind !== 'orphan' && EXCHANGE_ETF_PREFIX.test(r.code)
    const isMapped = !!r.mapping
    return (
      <TableRow key={`${r.kind}-${r.code}`}>
        <TableCell className="text-xs font-mono">{r.code}</TableCell>
        <TableCell className="text-xs">{r.name}</TableCell>
        <TableCell className="text-xs">
          {r.kind === 'orphan'
            ? <Badge variant="outline" className="text-[10px]">映射(无持仓)</Badge>
            : isEtf
              ? <Badge variant="outline" className="text-[10px]">场内ETF</Badge>
              : <Badge variant="secondary" className="text-[10px]">场外基金</Badge>}
        </TableCell>
        <TableCell className="text-xs font-mono">{isMapped ? r.mapping.exchangeCode : '-'}</TableCell>
        <TableCell className="text-xs">{isMapped ? r.mapping.exchangeName : '-'}</TableCell>
        <TableCell>
          {isEtf
            ? <Badge variant="secondary" className="text-[10px] text-muted-foreground">无需映射</Badge>
            : isMapped
              ? brokenCodes.has(r.mapping.exchangeCode)
                ? <Badge variant="destructive" className="text-[10px]">K线失败</Badge>
                : <Badge variant="secondary" className="text-[10px] text-green-600">已映射</Badge>
              : <Badge variant="destructive" className="text-[10px]">未映射</Badge>}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            {isEtf ? (
              <span className="text-[10px] text-muted-foreground">—</span>
            ) : isMapped ? (
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
  }

  const primaryRows = rows.filter((r) => !isActiveRow(r))
  const activeRows = rows.filter((r) => isActiveRow(r))

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">场内 ETF 映射</CardTitle>
            <CardDescription>
              所有持仓的场外基金 → 场内 ETF 对应关系（共 {rows.length} 项，{unmappedCount} 项未映射）
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" className="h-7 text-xs"
              variant="outline"
              onClick={handleBatchResolve}
              disabled={batchRunning || unmappedCount === 0}
            >
              {batchRunning
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />补全中 {batchProgress.done}/{batchProgress.total}</>
                : <><Wand2 className="h-3 w-3 mr-1" />批量补全未映射{unmappedCount > 0 ? ` (${unmappedCount})` : ''}</>}
            </Button>
            <Button
              size="sm" className="h-7 text-xs"
              variant="outline"
              onClick={handleDetect}
              disabled={detecting || etfMappings.length === 0}
            >
              {detecting
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />检测中 {detectProgress.done}/{detectProgress.total}</>
                : <><AlertTriangle className="h-3 w-3 mr-1" />检测错误映射</>}
            </Button>
            <Button
              size="sm" className="h-7 text-xs"
              variant="outline"
              onClick={handleAiFix}
              disabled={recommending || detecting || (health ? health.filter((h) => !h.ok).length === 0 : true)}
            >
              {recommending
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />推荐中 {recProgress.done}/{recProgress.total}</>
                : <><Wand2 className="h-3 w-3 mr-1" />AI 推荐修复</>}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={openAdd}>
              <Plus className="h-3 w-3 mr-1" />新增映射
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {health && health.some((h) => !h.ok) && (
          <div className="mb-3 flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              检测到 {health.filter((h) => !h.ok).length} 条映射 K 线取数失败（已在表格中红标「K线失败」）。
              可点上方「AI 推荐修复」生成修正建议，审阅后应用。
            </span>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            暂无持仓，也无映射。导入持仓或新增基金会自动建立映射，也可在此手动添加。
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[88px]">代码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[78px]">类型</TableHead>
                  <TableHead className="w-[88px]">场内ETF</TableHead>
                  <TableHead>场内名称</TableHead>
                  <TableHead className="w-[68px]">状态</TableHead>
                  <TableHead className="w-[130px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {primaryRows.map(renderRow)}
                {activeRows.length > 0 && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={7} className="py-1.5 text-center">
                      <span className="text-[10px] text-muted-foreground">
                        以下为主动型 / 名称未含「ETF」「指数」的基金 · 不参与批量补全
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {activeRows.map(renderRow)}
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

      <Dialog open={reviewOpen} onOpenChange={(v) => { if (!v) setReviewOpen(false) }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>AI 推荐修复 ETF 映射（请审阅后应用）</DialogTitle>
            <DialogDescription>
              以下为检测到的错误映射及 AI 推荐修正项（按 R1 同公司同指数 → R2 同指数跨公司 → R3 仅主题相关 排序，并经 K 线端点验证）。
              确认无误后点「应用」；可手动修改推荐代码/名称。
            </DialogDescription>
          </DialogHeader>

          {recommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              AI 未给出任何推荐（可能所有错误项都未匹配到合适的场内 ETF）。可手动编辑映射。
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[64px]">场外码</TableHead>
                    <TableHead>场外名称</TableHead>
                    <TableHead className="w-[78px]">当前(错误)</TableHead>
                    <TableHead className="w-[104px]">推荐代码</TableHead>
                    <TableHead>推荐名称</TableHead>
                    <TableHead className="w-[96px]">规则/置信</TableHead>
                    <TableHead className="w-[64px]">验证</TableHead>
                    <TableHead className="w-[64px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedRecs.map((r) => {
                    const edit = editRecs[r.otcCode] || {
                      code: r.recommendedExchangeCode,
                      name: r.recommendedExchangeName,
                    }
                    return (
                      <TableRow key={r.otcCode}>
                        <TableCell className="text-xs font-mono">{r.otcCode}</TableCell>
                        <TableCell className="text-xs">{r.otcName}</TableCell>
                        <TableCell className="text-xs font-mono text-destructive">{r.currentExchangeCode}</TableCell>
                        <TableCell>
                          <Input
                            value={edit.code}
                            onChange={(e) =>
                              setEditRecs((prev) => ({ ...prev, [r.otcCode]: { ...edit, code: e.target.value } }))
                            }
                            className="text-xs font-mono h-7 w-[92px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={edit.name}
                            onChange={(e) =>
                              setEditRecs((prev) => ({ ...prev, [r.otcCode]: { ...edit, name: e.target.value } }))
                            }
                            className="text-xs h-7"
                          />
                        </TableCell>
                        <TableCell className="text-[10px]">
                          <div>{ruleLabel(r.rule)}</div>
                          <div className="text-muted-foreground">置信 {(r.confidence * 100).toFixed(0)}%</div>
                          {r.reason && (
                            <div className="text-muted-foreground mt-0.5 max-w-[140px] leading-tight">{r.reason}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.verified
                            ? <Badge variant="secondary" className="text-[10px] text-green-600">已验证</Badge>
                            : <Badge variant="destructive" className="text-[10px]">未验证</Badge>}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm" className="h-7 text-xs"
                            onClick={() => handleApplyRec(r.otcCode)}
                            disabled={appliedCodes.has(r.otcCode)}
                          >
                            {appliedCodes.has(r.otcCode) ? '已应用' : '应用'}
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
              <X className="h-3 w-3 mr-1" />取消
            </Button>
            <Button size="sm" onClick={handleApplyAll} disabled={recommendations.length === 0}>
              全部应用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
