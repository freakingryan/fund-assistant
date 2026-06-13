import { useState, useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus, Loader2, Sparkles, ChevronDown, ChevronUp,
  AlertCircle, Trash2, X,
} from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { autoClassify } from '@/lib/classification'
import { fetchFundInfoByCodes, getDefaultAI } from '@/services/ai'
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
const MARKET_LABELS: Record<Market, string> = { A: 'A股', HK: '港股', US: '美股' }
const TYPE_LABELS: Record<string, string> = {
  stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型',
  qdii: 'QDII', money: '货币型', etf: 'ETF', other: '其他',
}

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

export default function AddFundDialog() {
  const [open, setOpen] = useState(false)
  const addHolding = useHoldingsStore((s) => s.addHolding)

  const [rows, setRows] = useState<FundRow[]>([makeRow()])
  const [error, setError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [showAllDetails, setShowAllDetails] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setAiConfigured(!!getDefaultAI())
      setRows([makeRow()])
      setError('')
      setSelected(new Set())
      setShowAllDetails(false)
    }
  }, [open])

  const codes = useMemo(() => rows.map((r) => r.code.trim()).filter(Boolean), [rows])

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

  // Toggle selection
  const toggleSelect = (key: string) => {
    setSelected((prev) => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  // Select all
  const selectAll = () => {
    setSelected(new Set(rows.filter((r) => r.code.trim()).map((r) => r.key)))
  }

  // Deselect all
  const deselectAll = () => setSelected(new Set())

  // AI batch query
  const handleAIQuery = async () => {
    if (codes.length === 0) { setError('请先输入基金代码'); return }
    setAiLoading(true); setError('')
    try {
      const results = await fetchFundInfoByCodes(codes)
      const typeMap: Record<string, FundType> = {
        '股票型': 'stock', '混合型': 'mixed', '债券型': 'bond',
        '指数型': 'index', 'qdii': 'qdii', '货币型': 'money', 'etf': 'etf',
      }
      const sectorMap: Record<string, FundSector> = {
        '科技': 'tech', '消费': 'consumer', '医药': 'healthcare',
        '新能源': 'new_energy', '金融': 'finance', '制造': 'manufacturing',
        '宽基': 'broad_market', '全球': 'global', '债市': 'bond_market',
        '大宗商品': 'commodity', '地产': 'real_estate',
      }
      setRows((prev) => prev.map((row) => {
        const match = results.find((r) => r.code === row.code?.trim())
        if (!match) return row
        const auto = autoClassify(match.code, match.name)
        return {
          ...row,
          name: match.name || row.name,
          type: typeMap[match.type] || auto.type,
          sector: sectorMap[match.sector] || auto.sector,
          description: match.description || '',
        }
      }))
    } catch (err) {
      setError(String(err))
    }
    setAiLoading(false)
  }

  const handleSubmit = async () => {
    setError('')
    const valid = rows.filter((r) => r.code.trim())
    if (valid.length === 0) { setError('请至少输入一个基金代码'); return }

    for (const row of valid) {
      await addHolding({
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
      })
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError('') }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />添加基金</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>添加基金</DialogTitle>
          <DialogDescription>
            只需输入基金代码（必填），其余信息可选。{aiConfigured && '点击「AI 查询」自动补全名称和分类。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* AI Query bar */}
          {aiConfigured && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAIQuery}
              disabled={codes.length === 0 || aiLoading}
              className="w-full"
            >
              {aiLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />AI 正在查询 {codes.length} 只基金...</>
              ) : (
                <><Sparkles className="h-3 w-3 mr-2" />AI 查询全部 ({codes.length} 只)</>
              )}
            </Button>
          )}

          {/* Fund rows */}
          <div className="space-y-3 max-h-[50vh] overflow-auto">
            {rows.map((row, idx) => (
              <div key={row.key} className="rounded-md border bg-slate-50/50 p-3 space-y-2">
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
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-12">方式一</span>
                  <Input
                    type="number" step="0.0001"
                    value={row.costNAV}
                    onChange={(e) => updateRow(row.key, 'costNAV', e.target.value)}
                    placeholder="持仓成本"
                    className="flex-1 h-7 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0">×</span>
                  <Input
                    type="number" step="0.01"
                    value={row.shares}
                    onChange={(e) => updateRow(row.key, 'shares', e.target.value)}
                    placeholder="持有份额"
                    className="flex-1 h-7 text-xs"
                  />
                </div>

                {/* 方式二：持有金额 + 持有收益 */}
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-12">方式二</span>
                  <Input
                    type="number" step="0.01"
                    value={row.holdingAmount}
                    onChange={(e) => updateRow(row.key, 'holdingAmount', e.target.value)}
                    placeholder="持有金额（投入总额）"
                    className="flex-1 h-7 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0">±</span>
                  <Input
                    type="number" step="0.01"
                    value={row.holdingProfit}
                    onChange={(e) => updateRow(row.key, 'holdingProfit', e.target.value)}
                    placeholder="持有收益（盈+亏-）"
                    className="flex-1 h-7 text-xs"
                  />
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
                  <div className="space-y-2 pt-1 border-t border-slate-200">
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

          <Button className="w-full" onClick={handleSubmit} disabled={codes.length === 0}>
            添加 {codes.length || 0} 只基金
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
