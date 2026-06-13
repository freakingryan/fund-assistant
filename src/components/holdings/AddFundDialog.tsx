import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Loader2, Sparkles, Search, AlertCircle } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { autoClassify } from '@/lib/classification'
import { fetchFundInfoByCode, getDefaultAI } from '@/services/ai'
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

export default function AddFundDialog() {
  const [open, setOpen] = useState(false)
  const addHolding = useHoldingsStore((s) => s.addHolding)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [market, setMarket] = useState<Market>('A')
  const [type, setType] = useState<FundType>('stock')
  const [sector, setSector] = useState<FundSector>('other')
  const [description, setDescription] = useState('')
  const [costNAV, setCostNAV] = useState('')
  const [shares, setShares] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10))
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiFetched, setAiFetched] = useState(false)

  useEffect(() => {
    if (open) setAiConfigured(!!getDefaultAI())
  }, [open])

  // AI 查询基金详情
  const handleAIFetch = useCallback(async () => {
    if (!code.trim()) return
    setAiLoading(true); setError('')
    try {
      const info = await fetchFundInfoByCode(code.trim())
      setName(info.name)
      setDescription(info.description)
      // 映射类型
      const typeMap: Record<string, FundType> = {
        '股票型': 'stock', '混合型': 'mixed', '债券型': 'bond',
        '指数型': 'index', 'qdii': 'qdii', '货币型': 'money',
        'etf': 'etf',
      }
      setType(typeMap[info.type] || 'stock')
      // 映射领域
      const sectorMap: Record<string, FundSector> = {
        '科技': 'tech', '消费': 'consumer', '医药': 'healthcare',
        '新能源': 'new_energy', '金融': 'finance', '制造': 'manufacturing',
        '宽基': 'broad_market', '全球': 'global', '债市': 'bond_market',
        '大宗商品': 'commodity', '地产': 'real_estate',
      }
      setSector(sectorMap[info.sector] || 'other')
      setAiFetched(true)
    } catch (err) {
      setError(String(err))
    }
    setAiLoading(false)
  }, [code])

  // 输入代码后自动推断
  const handleCodeBlur = useCallback(() => {
    if (!code.trim()) return
    const auto = autoClassify(code, '')
    setMarket(auto.market)
  }, [code])

  const handleSubmit = async () => {
    setError('')
    if (!code.trim()) { setError('请输入基金代码'); return }
    if (!name.trim()) { setError('请输入基金名称或点击 AI 查询'); return }
    if (!costNAV || Number(costNAV) <= 0) { setError('请输入有效的持仓成本'); return }
    if (!shares || Number(shares) <= 0) { setError('请输入有效的持有份额'); return }

    await addHolding({
      code: code.trim(),
      name: name.trim(),
      market, type, sector,
      costNAV: Number(costNAV),
      shares: Number(shares),
      purchaseDate,
      tags: tags ? tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      notes: notes || description,
    })

    setOpen(false)
    setTimeout(() => {
      setCode(''); setName(''); setMarket('A'); setType('stock'); setSector('other')
      setDescription(''); setCostNAV(''); setShares('')
      setPurchaseDate(new Date().toISOString().slice(0, 10))
      setTags(''); setNotes(''); setError(''); setAiFetched(false)
    }, 300)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError('') }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />添加基金</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>添加基金</DialogTitle>
          <DialogDescription>只需输入基金代码，其余信息可由 AI 自动获取</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* 代码 + AI 查询 */}
          <div className="space-y-2">
            <Label>基金代码 *</Label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => { setCode(e.target.value); setAiFetched(false) }}
                onBlur={handleCodeBlur}
                placeholder="如 000001"
                className="flex-1"
              />
              {aiConfigured && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAIFetch}
                  disabled={!code.trim() || aiLoading}
                  className="shrink-0"
                >
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <><Sparkles className="h-3 w-3 mr-1" />AI 查询</>
                  )}
                </Button>
              )}
            </div>
            {!aiConfigured && (
              <p className="text-[10px] text-muted-foreground">
                💡 在设置中配置 AI API Key 后，可自动获取基金详情
              </p>
            )}
          </div>

          {/* AI 获取结果 */}
          {aiFetched && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs space-y-1">
              <p className="font-medium flex items-center gap-1 text-blue-800">
                <Sparkles className="h-3 w-3" /> AI 识别结果
              </p>
              <p className="text-blue-700">{name}</p>
              {description && <p className="text-blue-600/70">{description}</p>}
            </div>
          )}

          {/* 基金名称 */}
          <div className="space-y-2">
            <Label>基金名称 *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="可手动输入或 AI 自动获取"
            />
          </div>

          {/* 市场/类型/领域 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label className="text-xs">市场</Label>
              <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as FundType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">领域</Label>
              <Select value={sector} onValueChange={(v) => setSector(v as FundSector)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SECTOR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 成本和份额 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>持仓成本 *</Label>
              <Input type="number" step="0.0001" value={costNAV}
                onChange={(e) => setCostNAV(e.target.value)} placeholder="净值成本" />
            </div>
            <div className="space-y-2">
              <Label>持有份额 *</Label>
              <Input type="number" step="0.01" value={shares}
                onChange={(e) => setShares(e.target.value)} placeholder="持有份额" />
            </div>
          </div>

          {/* 日期和标签 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>购买日期</Label>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>标签</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="逗号分隔" />
            </div>
          </div>

          {/* 备注 */}
          <div className="space-y-2">
            <Label>备注</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="选填" />
          </div>

          {error && <p className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />{error}
          </p>}

          <Button className="w-full" onClick={handleSubmit}>添加基金</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
