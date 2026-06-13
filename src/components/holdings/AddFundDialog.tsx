import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { autoClassify } from '@/lib/classification'
import type { Market, FundType, FundSector } from '@/types'

const MARKET_OPTIONS: { value: Market; label: string }[] = [
  { value: 'A', label: 'A股' },
  { value: 'HK', label: '港股' },
  { value: 'US', label: '美股' },
]

const TYPE_OPTIONS: { value: FundType; label: string }[] = [
  { value: 'stock', label: '股票型' },
  { value: 'mixed', label: '混合型' },
  { value: 'bond', label: '债券型' },
  { value: 'index', label: '指数型' },
  { value: 'qdii', label: 'QDII' },
  { value: 'money', label: '货币型' },
  { value: 'etf', label: 'ETF' },
  { value: 'other', label: '其他' },
]

const SECTOR_OPTIONS: { value: FundSector; label: string }[] = [
  { value: 'tech', label: '科技' },
  { value: 'consumer', label: '消费' },
  { value: 'healthcare', label: '医药' },
  { value: 'new_energy', label: '新能源' },
  { value: 'finance', label: '金融' },
  { value: 'manufacturing', label: '制造' },
  { value: 'broad_market', label: '宽基' },
  { value: 'global', label: '全球' },
  { value: 'bond_market', label: '债市' },
  { value: 'commodity', label: '大宗商品' },
  { value: 'real_estate', label: '地产' },
  { value: 'other', label: '其他' },
]

export default function AddFundDialog() {
  const [open, setOpen] = useState(false)
  const addHolding = useHoldingsStore((s) => s.addHolding)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [market, setMarket] = useState<Market>('A')
  const [type, setType] = useState<FundType>('stock')
  const [sector, setSector] = useState<FundSector>('other')
  const [costNAV, setCostNAV] = useState('')
  const [shares, setShares] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10))
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const handleCodeBlur = useCallback(() => {
    if (code && !name) {
      // 后续可以从 Tushare 获取名称，这里先占位
    }
    if (code) {
      const auto = autoClassify(code, name || code)
      setMarket(auto.market)
      if (!name) setType(auto.type)
      setSector(auto.sector)
    }
  }, [code, name])

  const handleNameBlur = useCallback(() => {
    if (name && code) {
      const auto = autoClassify(code, name)
      setType(auto.type)
      setSector(auto.sector)
    }
  }, [code, name])

  const handleSubmit = async () => {
    setError('')
    if (!code.trim()) { setError('请输入基金代码'); return }
    if (!name.trim()) { setError('请输入基金名称'); return }
    if (!costNAV || Number(costNAV) <= 0) { setError('请输入有效的持仓成本'); return }
    if (!shares || Number(shares) <= 0) { setError('请输入有效的持有份额'); return }

    await addHolding({
      code: code.trim(),
      name: name.trim(),
      market,
      type,
      sector,
      costNAV: Number(costNAV),
      shares: Number(shares),
      purchaseDate,
      tags: tags ? tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      notes,
    })

    setOpen(false)
    // Reset form
    setTimeout(() => {
      setCode(''); setName(''); setMarket('A'); setType('stock'); setSector('other')
      setCostNAV(''); setShares('')
      setPurchaseDate(new Date().toISOString().slice(0, 10))
      setTags(''); setNotes(''); setError('')
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
          <DialogDescription>手动录入基金持仓信息，输入代码后自动推断类型和领域</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>基金代码 *</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={handleCodeBlur}
                placeholder="如 000001"
              />
            </div>
            <div className="space-y-2">
              <Label>基金名称 *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                placeholder="如 华夏成长"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label>市场</Label>
              <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARKET_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as FundType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>领域</Label>
              <Select value={sector} onValueChange={(v) => setSector(v as FundSector)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SECTOR_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>持仓成本 *</Label>
              <Input
                type="number"
                step="0.0001"
                value={costNAV}
                onChange={(e) => setCostNAV(e.target.value)}
                placeholder="净值成本"
              />
            </div>
            <div className="space-y-2">
              <Label>持有份额 *</Label>
              <Input
                type="number"
                step="0.01"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="持有份额"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>购买日期</Label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>标签（逗号分隔）</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="如 定投, 长期持有" />
          </div>

          <div className="space-y-2">
            <Label>备注</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="自定义备注" />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" onClick={handleSubmit}>添加基金</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
