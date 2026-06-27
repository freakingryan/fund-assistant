import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { AlertCircle, Loader2, Sparkles, Search, Plus, X } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { autoClassify } from '@/lib/classification'
import { getFundInfoCache, setFundInfoCache } from '@/services/klineCache'
import { fetchEtfMapping } from '@/services/ai'
import type { Market, FundType, FundSector, FundHolding } from '@/types'

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

const TYPE_MAP: Record<string, FundType> = {
  '股票型': 'stock', '混合型': 'mixed', '债券型': 'bond',
  '指数型': 'index', 'qdii': 'qdii', '货币型': 'money', 'etf': 'etf',
}

interface Props {
  fund: FundHolding | null
  open: boolean
  onOpenChange: (v: boolean) => void
}

export default function EditFundDialog({ fund, open, onOpenChange }: Props) {
  const updateHolding = useHoldingsStore((s) => s.updateHolding)
  const addEtfMapping = useSettingsStore((s) => s.addEtfMapping)
  const removeEtfMapping = useSettingsStore((s) => s.removeEtfMapping)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)

  // 基础字段
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [market, setMarket] = useState<Market>('A')
  const [type, setType] = useState<FundType>('stock')
  const [sector, setSector] = useState<FundSector>('other')
  const [costNAV, setCostNAV] = useState('')
  const [shares, setShares] = useState('')
  const [holdingAmount, setHoldingAmount] = useState('')
  const [holdingProfit, setHoldingProfit] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [queryLoading, setQueryLoading] = useState(false)
  const [akshareReady, setAkshareReady] = useState(false)

  // ETF 映射字段
  const [etfOpen, setEtfOpen] = useState(false)
  const [exchangeCode, setExchangeCode] = useState('')
  const [exchangeName, setExchangeName] = useState('')
  const [etfSearchLoading, setEtfSearchLoading] = useState(false)
  const [etfSearchResults, setEtfSearchResults] = useState<{ exchangeCode: string; exchangeName: string }[]>([])

  // 当前基金的映射索引
  const currentMappingIndex = fund ? etfMappings.findIndex((m) => m.otcCode === fund.code) : -1
  const currentMapping = currentMappingIndex >= 0 ? etfMappings[currentMappingIndex] : null

  // 打开时预填数据
  useEffect(() => {
    if (open && fund) {
      setCode(fund.code)
      setName(fund.name)
      setMarket(fund.market)
      setType(fund.type)
      setSector(fund.sector)
      setCostNAV(fund.costNAV ? String(fund.costNAV) : '')
      setShares(fund.shares ? String(fund.shares) : '')
      setHoldingAmount(fund.holdingAmount ? String(fund.holdingAmount) : '')
      setHoldingProfit(fund.holdingProfit !== undefined ? String(fund.holdingProfit) : '')
      setPurchaseDate(fund.purchaseDate || '')
      setTags(fund.tags ? fund.tags.join(',') : '')
      setNotes(fund.notes || '')
      setError('')
      setSaving(false)
      setQueryLoading(false)
      setAkshareReady(dataSourceService.isAkshareConfigured())
      // ETF 映射
      const m = etfMappings.find((em) => em.otcCode === fund.code)
      setExchangeCode(m?.exchangeCode || '')
      setExchangeName(m?.exchangeName || '')
      setEtfOpen(false)
      setEtfSearchResults([])
    }
  }, [open, fund, etfMappings])

  // AKTools 自动补全
  const handleAutofill = async () => {
    if (!code.trim()) { setError('请先输入基金代码'); return }
    setQueryLoading(true); setError('')

    try {
      const cached = await getFundInfoCache(code.trim())
      if (cached) {
        setName(cached.name || name)
        setType(TYPE_MAP[cached.type] || type)
        setSector(cached.sector as FundSector || sector)
      } else {
        const info = await dataSourceService.fetchFundInfo(code.trim())
        if (info.name && info.name !== code.trim()) {
          setName(info.name)
          const auto = autoClassify(code.trim(), info.name)
          setType(TYPE_MAP[info.type] || auto.type)
          setSector(auto.sector)
          await setFundInfoCache(code.trim(), {
            code: code.trim(), name: info.name,
            type: info.type || auto.type, sector: auto.sector, description: '',
          })
        }
      }

      // 自动查询 ETF 映射
      const alreadyMapped = etfMappings.some((m) => m.otcCode === code.trim())
      if (!alreadyMapped) {
        try {
          const mapping = await dataSourceService.queryEtfMapping(code.trim())
          if (mapping?.exchangeCode) {
            addEtfMapping(mapping.otcCode, mapping.otcName, mapping.exchangeCode, mapping.exchangeName)
            setExchangeCode(mapping.exchangeCode)
            setExchangeName(mapping.exchangeName)
            toast({ type: 'success', message: `ETF 映射已添加：${mapping.exchangeCode} ${mapping.exchangeName}` })
          } else {
            toast({ type: 'info', message: `基金 ${code.trim()} 未找到对应场内 ETF 映射，可在下方手动配置替补 ETF` })
          }
        } catch {
          toast({ type: 'warning', message: `查询 ETF 映射失败：${code.trim()}` })
        }
      } else {
        const m = etfMappings.find((m) => m.otcCode === code.trim())
        if (m) {
          setExchangeCode(m.exchangeCode)
          setExchangeName(m.exchangeName)
          toast({ type: 'success', message: `ETF 映射已存在：${m.exchangeCode} ${m.exchangeName}` })
        }
      }
    } catch (err) {
      setError(String(err))
    }
    setQueryLoading(false)
  }

  // AI 搜索替补 ETF
  const handleSearchEtf = async () => {
    const searchKeyword = name || code
    if (!searchKeyword.trim()) { toast({ type: 'warning', message: '请输入基金名称或代码' }); return }
    setEtfSearchLoading(true)
    setEtfSearchResults([])
    try {
      // 先尝试 AKTools 的 ETF 列表查询
      try {
        const result = await dataSourceService.queryEtfMapping(code.trim())
        if (result?.exchangeCode) {
          setEtfSearchResults([{ exchangeCode: result.exchangeCode, exchangeName: result.exchangeName }])
          setEtfSearchLoading(false)
          return
        }
      } catch { /* fallback */ }

      // 通过 AI 搜索相近 ETF
      try {
        const aiResult = await fetchEtfMapping(code.trim())
        if (aiResult?.exchangeCode) {
          setEtfSearchResults([{ exchangeCode: aiResult.exchangeCode, exchangeName: aiResult.exchangeName }])
          setEtfSearchLoading(false)
          return
        }
      } catch { /* fallback */ }

      // 提示用户手动输入
      toast({ type: 'info', message: '未自动匹配到 ETF，请手动搜索或输入场内代码' })
    } catch (err) {
      toast({ type: 'error', message: String(err) })
    }
    setEtfSearchLoading(false)
  }

  // 保存 ETF 映射
  const handleSaveMapping = () => {
    if (!code.trim() || !exchangeCode.trim()) { toast({ type: 'warning', message: '请输入场内 ETF 代码' }); return }
    if (currentMappingIndex >= 0) {
      removeEtfMapping(currentMappingIndex)
    }
    addEtfMapping(code.trim(), name.trim() || code.trim(), exchangeCode.trim(), exchangeName.trim() || exchangeCode.trim())
    toast({ type: 'success', message: `ETF 映射已保存：${exchangeCode.trim()} ${exchangeName.trim() || ''}` })
    setEtfOpen(false)
  }

  // 删除 ETF 映射
  const handleRemoveMapping = () => {
    if (currentMappingIndex >= 0) {
      removeEtfMapping(currentMappingIndex)
      setExchangeCode('')
      setExchangeName('')
      toast({ type: 'info', message: 'ETF 映射已移除' })
    }
  }

  const handleSave = async () => {
    if (!fund) return
    if (!code.trim()) { setError('基金代码不能为空'); return }
    setSaving(true); setError('')

    try {
      await updateHolding(fund.id, {
        code: code.trim(), name: name.trim() || code.trim(),
        market, type, sector,
        costNAV: Number(costNAV) || 0, shares: Number(shares) || 0,
        holdingAmount: Number(holdingAmount) || 0, holdingProfit: Number(holdingProfit) || 0,
        purchaseDate,
        tags: tags ? tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
        notes,
      })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onOpenChange(v) }}>
      <DialogContent className="max-w-[90vw] sm:max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>编辑基金 — {fund?.name || fund?.code}</DialogTitle>
          <DialogDescription>修改以下字段后保存，留空的字段会保持原值。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* AKTools 自动补全 */}
          {akshareReady && (
            <Button
              variant="secondary" size="sm"
              onClick={handleAutofill}
              disabled={!code.trim() || queryLoading}
              className="w-full h-7 text-xs"
            >
              {queryLoading ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />查询中...</>
              ) : (
                <><Sparkles className="h-3 w-3 mr-1" />AKTools 自动补全名称 / 类型 / 领域 + ETF 映射</>
              )}
            </Button>
          )}

          {/* 代码 + 名称 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">基金代码</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">基金名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>

          {/* 方式一：成本 + 份额 */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">持仓成本（方式一）</Label>
              <Input type="number" step="0.0001" value={costNAV}
                onChange={(e) => setCostNAV(e.target.value)}
                placeholder="留空不修改" className="h-7 text-xs" />
            </div>
            <span className="text-[10px] text-muted-foreground pb-1.5">×</span>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">持有份额（方式一）</Label>
              <Input type="number" step="0.01" value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="留空不修改" className="h-7 text-xs" />
            </div>
          </div>

          {/* 方式二：持有金额 + 持有收益 */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">持有金额（方式二）</Label>
              <Input type="number" step="0.01" value={holdingAmount}
                onChange={(e) => setHoldingAmount(e.target.value)}
                placeholder="留空不修改" className="h-7 text-xs" />
            </div>
            <span className="text-[10px] text-muted-foreground pb-1.5">±</span>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">持有收益（方式二）</Label>
              <Input type="number" step="0.01" value={holdingProfit}
                onChange={(e) => setHoldingProfit(e.target.value)}
                placeholder="盈+亏-" className="h-7 text-xs" />
            </div>
          </div>

          {/* 市场 + 类型 + 领域 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">市场</Label>
              <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as FundType)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">领域</Label>
              <Select value={sector} onValueChange={(v) => setSector(v as FundSector)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SECTOR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 日期 + 标签 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">购买日期</Label>
              <Input type="date" value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">标签</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔" className="h-7 text-xs" />
            </div>
          </div>

          {/* 备注 */}
          <div className="space-y-1">
            <Label className="text-xs">备注</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="选填" className="h-7 text-xs" />
          </div>

          {/* ─── ETF 映射配置 ─────────────────────────────── */}
          <div className="border rounded-md p-3 space-y-3 bg-muted/10">
            <button
              onClick={() => setEtfOpen(!etfOpen)}
              className="flex items-center gap-1.5 text-xs font-medium text-foreground w-full text-left cursor-pointer"
            >
              <span className={`inline-block transition-transform ${etfOpen ? 'rotate-90' : ''}`}>▶</span>
              ETF 映射配置
              {currentMapping && (
                <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                  （当前：{currentMapping.exchangeCode} {currentMapping.exchangeName}）
                </span>
              )}
              {!currentMapping && (
                <span className="ml-1 text-[10px] text-orange-500 font-normal">未配置</span>
              )}
            </button>

            {etfOpen && (
              <div className="space-y-2.5 pl-3 border-l-2 border-muted">
                {/* 当前映射状态 */}
                {currentMapping && (
                  <div className="flex items-center justify-between text-[11px] bg-muted/20 rounded px-2 py-1.5">
                    <span>
                      <span className="font-mono">{currentMapping.otcCode}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="font-mono font-medium">{currentMapping.exchangeCode}</span>
                      <span className="text-muted-foreground ml-1">{currentMapping.exchangeName}</span>
                    </span>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleRemoveMapping}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* AI 搜索替补 ETF */}
                <div className="flex gap-1.5">
                  <Input
                    value={exchangeCode}
                    onChange={(e) => setExchangeCode(e.target.value)}
                    placeholder="场内 ETF 代码（如 159558）"
                    className="h-7 text-xs font-mono flex-1"
                  />
                  <Input
                    value={exchangeName}
                    onChange={(e) => setExchangeName(e.target.value)}
                    placeholder="ETF 名称（选填）"
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    variant="secondary" size="sm" className="h-7 text-xs shrink-0"
                    onClick={handleSearchEtf}
                    disabled={etfSearchLoading || !code.trim()}
                  >
                    {etfSearchLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                  </Button>
                </div>

                {/* AI 搜索结果 */}
                {etfSearchResults.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">搜索结果：</p>
                    {etfSearchResults.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-primary/5 hover:bg-primary/10 cursor-pointer transition-colors"
                        onClick={() => { setExchangeCode(r.exchangeCode); setExchangeName(r.exchangeName); setEtfSearchResults([]) }}
                      >
                        <span>
                          <span className="font-mono font-medium">{r.exchangeCode}</span>
                          <span className="text-muted-foreground ml-1">{r.exchangeName}</span>
                        </span>
                        <span className="text-[10px] text-primary">选择</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 保存映射 */}
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveMapping} disabled={!exchangeCode.trim()}>
                    <Plus className="h-3 w-3 mr-1" />
                    {currentMapping ? '更新映射' : '添加映射'}
                  </Button>
                  <p className="text-[9px] text-muted-foreground/60 self-center">
                    映射后可在 K 线图查看该 ETF 的真实行情
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{error}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />保存中</> : '保存'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
