import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Plus, Loader2, Sparkles, ChevronDown, ChevronUp,
  AlertCircle, X, Search,
} from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { useSettingsStore } from '@/stores/settings'
import { autoClassify } from '@/lib/classification'
import { dataSourceService } from '@/adapters/datasource/service'
import { getEtfMappingCache, setEtfMappingCache } from '@/services/klineCache'
import { cn } from '@/lib/utils'
import type { Market, FundType, FundSector } from '@/types'

const MARKET_OPTIONS: { value: Market; label: string }[] = [
  { value: 'A', label: 'A股' }, { value: 'HK', label: '港股' }, { value: 'US', label: '美股' },
]
const TYPE_OPTIONS: { value: FundType; label: string }[] = [
  { value: 'stock', label: '股票型' }, { value: 'mixed', label: '混合型' },
  { value: 'bond', label: '债券型' }, { value: 'index', label: '指数型' },
  { value: 'qdii', label: 'QDII' }, { value: 'money', label: '货币型' },
  { value: 'etf', label: 'ETF' }, { value: 'other', label: '其他' },
]
const SECTOR_OPTIONS: { value: FundSector; label: string }[] = [
  { value: 'tech', label: '科技' }, { value: 'consumer', label: '消费' },
  { value: 'healthcare', label: '医药' }, { value: 'new_energy', label: '新能源' },
  { value: 'finance', label: '金融' }, { value: 'manufacturing', label: '制造' },
  { value: 'broad_market', label: '宽基' }, { value: 'global', label: '全球' },
  { value: 'bond_market', label: '债市' }, { value: 'commodity', label: '大宗商品' },
  { value: 'real_estate', label: '地产' }, { value: 'other', label: '其他' },
]

interface FundRow {
  key: string
  code: string
  name: string
  market: Market
  type: FundType
  sector: FundSector
  description: string
  costNAV: string
  shares: string
  holdingAmount: string
  holdingProfit: string
  purchaseDate: string
  tags: string
  notes: string
  expanded: boolean
}

function makeRow(code = ''): FundRow {
  return {
    key: crypto.randomUUID(),
    code, name: '', market: 'A', type: 'stock', sector: 'other',
    description: '', costNAV: '', shares: '', holdingAmount: '', holdingProfit: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    tags: '', notes: '', expanded: false,
  }
}

// F9: 表单实时校验 — 空值允许；填入后必须是数字，金额/份额/成本不可为负（持有收益可负）
function numericError(v: string, allowNegative = false): string | null {
  if (v.trim() === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return '需为数字'
  if (!allowNegative && n < 0) return '不能为负'
  return null
}

export default function AddFundDialog() {
  const [open, setOpen] = useState(false)
  const importHoldings = useHoldingsStore((s) => s.importHoldings)
  const addEtfMapping = useSettingsStore((s) => s.addEtfMapping)

  const [rows, setRows] = useState<FundRow[]>([makeRow()])
  const [error, setError] = useState('')
  const [queryLoading, setQueryLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showAllDetails, setShowAllDetails] = useState(false)
  const [, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  // ETF 映射查询结果：otcCode → { exchangeCode, exchangeName } | null（null=未找到）
  const [etfLookupResults, setEtfLookupResults] = useState<Map<string, { exchangeCode: string; exchangeName: string } | null>>(new Map())

  useEffect(() => {
    if (open) {
      setRows([makeRow()])
      setError('')
      setSelected(new Set())
      setShowAllDetails(false)
      setSearchQuery('')
      setSearchResults([])
      setEtfLookupResults(new Map())
    }
  }, [open])

  const codes = useMemo(() => rows.map((r) => r.code.trim()).filter(Boolean), [rows])
  const searchCode = useMemo(() => /^\d{6}$/.test(searchQuery.trim()) ? searchQuery.trim() : '', [searchQuery])
  const totalCodes = useMemo(() => {
    const set = new Set(codes)
    if (searchCode) set.add(searchCode)
    return [...set]
  }, [codes, searchCode])

  // 搜索防抖
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await dataSourceService.searchFunds(searchQuery.trim())
        setSearchResults(results.slice(0, 20))
      } catch { setSearchResults([]) }
      setSearchLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  const handleSelectFromSearch = (fund: { code: string; name: string }) => {
    // 1) 将代码填入搜索框
    setSearchQuery(fund.code)
    setSearchResults([])
    // 2) 立即填充基金行（代码 + 名称 + 自动分类）
    setRows((prev) => {
      if (prev.some((r) => r.code.trim() === fund.code)) return prev
      const auto = autoClassify(fund.code, fund.name)
      const rowData = {
        code: fund.code,
        name: fund.name,
        type: auto.type,
        sector: auto.sector,
      }
      const firstEmpty = prev.findIndex((r) => !r.code.trim())
      if (firstEmpty >= 0) {
        return prev.map((r, i) => i === firstEmpty ? { ...r, ...rowData } : r)
      }
      return [...prev, { ...makeRow(), ...rowData }]
    })
    // ETF 映射不在此处展示，用户点击「查找 ETF 映射」按钮后统一查询展示
  }

  // Add empty row
  const addRow = () => setRows((prev) => [...prev, makeRow()])

  // Remove row
  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
    setSelected((prev) => { const s = new Set(prev); s.delete(key); return s })
  }

  // Update a row field
  const updateRow = (key: string, field: keyof FundRow, value: string) => {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, [field]: value } : r))
  }

  // Toggle row expanded
  const toggleExpand = (key: string) => {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, expanded: !r.expanded } : r))
  }

  // Toggle all expanded
  const toggleShowAll = () => {
    setShowAllDetails((v) => {
      const next = !v
      setRows((prev) => prev.map((r) => ({ ...r, expanded: next })))
      return next
    })
  }

  // 查询 ETF 映射（仅映射，不补全基金信息）
  const handleEtfMappingLookup = async () => {
    const codesFromRows = rows.map((r) => r.code.trim()).filter(Boolean)
    const searchCode = /^\d{6}$/.test(searchQuery.trim()) ? searchQuery.trim() : ''
    const allCodes = [...new Set([...codesFromRows, ...(searchCode ? [searchCode] : [])])]

    if (allCodes.length === 0) { setError('请先输入或搜索基金代码'); return }
    setQueryLoading(true); setError('')

    try {
      // 清空上次查询结果
      setEtfLookupResults(new Map())

      // 添加搜索框中的新代码到行（如果尚未存在且搜索框有代码）
      if (searchCode && !codesFromRows.includes(searchCode)) {
        setRows((prev) => {
          if (prev.some((r) => r.code.trim() === searchCode)) return prev
          const auto = autoClassify(searchCode, '')
          const rowData = { code: searchCode, name: '', type: auto.type, sector: auto.sector }
          const firstEmpty = prev.findIndex((r) => !r.code.trim())
          if (firstEmpty >= 0) return prev.map((r, i) => i === firstEmpty ? { ...r, ...rowData } : r)
          return [...prev, { ...makeRow(), ...rowData }]
        })
      }

      // 并行查询 ETF 映射
      const results = await Promise.allSettled(
        allCodes.map(async (code) => {
          const cached = await getEtfMappingCache(code)
          if (cached) return cached
          const mapping = await dataSourceService.queryEtfMapping(code)
          if (mapping?.exchangeCode) {
            await setEtfMappingCache(code, mapping)
            return mapping
          }
          return null
        })
      )

      const newResults = new Map<string, { exchangeCode: string; exchangeName: string } | null>()
      let succeeded = 0
      let failed = 0

      for (const [i, result] of results.entries()) {
        const code = allCodes[i]
        if (result.status === 'fulfilled' && result.value) {
          succeeded++
          newResults.set(code, { exchangeCode: result.value.exchangeCode, exchangeName: result.value.exchangeName })
          addEtfMapping(result.value.otcCode, result.value.otcName, result.value.exchangeCode, result.value.exchangeName)
        } else {
          failed++
          newResults.set(code, null)
        }
      }

      setEtfLookupResults(newResults)
      toast({ type: succeeded > 0 ? 'success' : 'info', message: `ETF 映射查询完成：${succeeded} 条成功${failed > 0 ? `，${failed} 条未找到映射` : ''}` })
    } catch (err) {
      setError(String(err))
    }
    setQueryLoading(false)
  }

  const handleSubmit = async () => {
    setError('')
    let validRows = rows.filter((r) => r.code.trim())
    
    // 如果搜索框有代码且未在行中，补充新增
    if (searchCode && !validRows.some((r) => r.code.trim() === searchCode)) {
      const auto = autoClassify(searchCode, '')
      validRows = [...validRows, { ...makeRow(), code: searchCode, ...auto }]
    }

    if (validRows.length === 0) { setError('请至少输入一个基金代码'); return }

    const records = validRows.map((row) => ({
      code: row.code.trim(),
      name: row.name.trim() || row.code.trim(),
      market: row.market,
      type: row.type,
      sector: row.sector,
      costNAV: Number(row.costNAV) || 0,
      shares: Number(row.shares) || 0,
      holdingAmount: Number(row.holdingAmount) || 0,
      holdingProfit: Number(row.holdingProfit) || 0,
      purchaseDate: row.purchaseDate,
      tags: row.tags ? row.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      notes: row.notes || row.description,
    }))
    setSubmitting(true)
    try {
      await importHoldings(records)
      toast({ type: 'success', message: `已添加 ${records.length} 只基金` })
      setOpen(false)
    } catch (err) {
      setError(String(err))
      toast({ type: 'error', message: '添加失败，请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError('') }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />添加基金</Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>添加基金</DialogTitle>
          <DialogDescription>
            从搜索框搜索基金，点击「+」自动补全信息。再点击「查找 ETF 映射」查询场内对应 ETF。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索基金/ETF 名称或代码（如：半导体、沪深300）"
              className="pl-8 h-9 text-sm"
            />
            {searchLoading && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {/* 搜索结果下拉 */}
            {searchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
                {searchResults.map((r) => (
                  <button
                    key={r.code}
                    className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent text-left cursor-pointer"
                    onClick={() => handleSelectFromSearch(r)}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground w-20">{r.code}</span>
                    <span className="truncate">{r.name}</span>
                    <Plus className="h-3 w-3 shrink-0 text-muted-foreground ml-auto" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 查找 ETF 映射 */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleEtfMappingLookup}
            disabled={totalCodes.length === 0 || queryLoading}
            className="w-full"
          >
            {queryLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />正在查询 ETF 映射...</>
            ) : (
              <><Sparkles className="h-3 w-3 mr-2" />查找 ETF 映射 ({totalCodes.length} 只)</>
            )}
          </Button>

          {/* Fund rows */}
          <div className="space-y-3 max-h-[50vh] overflow-auto">
            {rows.map((row, idx) => (
              <div key={row.key} className="rounded-md border bg-muted/10 p-3 space-y-2">
                {/* Row header */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono shrink-0">#{idx + 1}</span>
                  <Input
                    value={row.code}
                    onChange={(e) => updateRow(row.key, 'code', e.target.value)}
                    placeholder="基金代码（必填）"
                    className="h-8 text-sm flex-1 font-mono"
                  />
                  <Input
                    value={row.name}
                    onChange={(e) => updateRow(row.key, 'name', e.target.value)}
                    placeholder="基金名称"
                    className="h-8 text-sm flex-[2]"
                  />
                  {rows.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeRow(row.key)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* 方式一：成本 + 份额 */}
                <div className="flex gap-2 items-start">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-12 pt-1.5">方式一</span>
                  <div className="flex-1 space-y-0.5">
                    <Input
                      type="number" step="0.0001"
                      value={row.costNAV}
                      onChange={(e) => updateRow(row.key, 'costNAV', e.target.value)}
                      placeholder="持仓成本"
                      aria-invalid={!!numericError(row.costNAV)}
                      className={cn('h-7 text-xs', numericError(row.costNAV) && 'border-destructive focus-visible:ring-destructive')}
                    />
                    {numericError(row.costNAV) && <p className="text-[9px] text-destructive leading-none">{numericError(row.costNAV)}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 pt-1.5">×</span>
                  <div className="flex-1 space-y-0.5">
                    <Input
                      type="number" step="0.01"
                      value={row.shares}
                      onChange={(e) => updateRow(row.key, 'shares', e.target.value)}
                      placeholder="持有份额"
                      aria-invalid={!!numericError(row.shares)}
                      className={cn('h-7 text-xs', numericError(row.shares) && 'border-destructive focus-visible:ring-destructive')}
                    />
                    {numericError(row.shares) && <p className="text-[9px] text-destructive leading-none">{numericError(row.shares)}</p>}
                  </div>
                </div>

                {/* 方式二：持有金额 + 持有收益 */}
                <div className="flex gap-2 items-start">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-12 pt-1.5">方式二</span>
                  <div className="flex-1 space-y-0.5">
                    <Input
                      type="number" step="0.01"
                      value={row.holdingAmount}
                      onChange={(e) => updateRow(row.key, 'holdingAmount', e.target.value)}
                      placeholder="持有金额（总市值）"
                      aria-invalid={!!numericError(row.holdingAmount)}
                      className={cn('h-7 text-xs', numericError(row.holdingAmount) && 'border-destructive focus-visible:ring-destructive')}
                    />
                    {numericError(row.holdingAmount) && <p className="text-[9px] text-destructive leading-none">{numericError(row.holdingAmount)}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 pt-1.5">±</span>
                  <div className="flex-1 space-y-0.5">
                    <Input
                      type="number" step="0.01"
                      value={row.holdingProfit}
                      onChange={(e) => updateRow(row.key, 'holdingProfit', e.target.value)}
                      placeholder="持有收益（盈+亏-）"
                      aria-invalid={!!numericError(row.holdingProfit, true)}
                      className={cn('h-7 text-xs', numericError(row.holdingProfit, true) && 'border-destructive focus-visible:ring-destructive')}
                    />
                    {numericError(row.holdingProfit, true) && <p className="text-[9px] text-destructive leading-none">{numericError(row.holdingProfit, true)}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    onClick={() => toggleExpand(row.key)}
                  >
                    {row.expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    更多
                  </Button>
                </div>

                {/* AI description hint */}
                {row.description && (
                  <p className="text-[11px] text-blue-600/70">
                    <Sparkles className="h-3 w-3 inline mr-1" />{row.description}
                  </p>
                )}

                {/* Expandable detail fields */}
                {row.expanded && (
                  <div className="space-y-2 pt-1 border-t">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">市场</Label>
                        <Select value={row.market} onValueChange={(v) => updateRow(row.key, 'market', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MARKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">类型</Label>
                        <Select value={row.type} onValueChange={(v) => updateRow(row.key, 'type', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">领域</Label>
                        <Select value={row.sector} onValueChange={(v) => updateRow(row.key, 'sector', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SECTOR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">购买日期</Label>
                        <Input type="date" value={row.purchaseDate}
                          onChange={(e) => updateRow(row.key, 'purchaseDate', e.target.value)}
                          className="h-7 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">标签</Label>
                        <Input value={row.tags}
                          onChange={(e) => updateRow(row.key, 'tags', e.target.value)}
                          placeholder="逗号分隔" className="h-7 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">备注</Label>
                      <Input value={row.notes}
                        onChange={(e) => updateRow(row.key, 'notes', e.target.value)}
                        placeholder="选填" className="h-7 text-xs" />
                    </div>
                  </div>
                )}

                {/* ETF 映射结果展示 */}
                {(() => {
                  const etf = etfLookupResults.get(row.code.trim())
                  if (etf === undefined) return null // 未查询
                  if (etf === null) return (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />未找到场内 ETF 映射
                    </p>
                  )
                  return (
                    <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 p-2.5 space-y-1.5">
                      <p className="text-[10px] font-medium text-green-700 dark:text-green-400">📈 场内 ETF 映射</p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={etf.exchangeCode}
                          readOnly
                          className="h-7 text-xs font-mono flex-1 bg-transparent border-green-200 dark:border-green-800"
                        />
                        <Input
                          value={etf.exchangeName}
                          readOnly
                          className="h-7 text-xs flex-[2] bg-transparent border-green-200 dark:border-green-800"
                        />
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>

          {/* Add row + expand all */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addRow}>
              <Plus className="h-3 w-3 mr-1" />添加基金代码
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleShowAll}>
              {showAllDetails ? '收起' : '展开'}全部详情
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{error}
            </p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={totalCodes.length === 0 || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            添加 {totalCodes.length || 0} 只基金
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
