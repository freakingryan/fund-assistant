import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertCircle, Loader2, Plus, Minus, TrendingUp, TrendingDown } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import { dataSourceService } from '@/adapters/datasource/service'
import { getQuotesCache } from '@/services/klineCache'
import type { FundHolding } from '@/types'

interface Props {
  fund: FundHolding | null
  open: boolean
  onOpenChange: (v: boolean) => void
}

type ReduceMode = 'shares' | 'amount' | 'ratio'

const RATIO_PRESETS = [
  { label: '1/2', value: 0.5 },
  { label: '1/3', value: 1 / 3 },
  { label: '1/4', value: 0.25 },
  { label: '1/5', value: 0.2 },
  { label: '2/3', value: 2 / 3 },
  { label: '3/4', value: 0.75 },
]

export default function QuickAdjustDialog({ fund, open, onOpenChange }: Props) {
  const updateHolding = useHoldingsStore((s) => s.updateHolding)

  const [action, setAction] = useState<'add' | 'reduce'>('add')
  const [reduceMode, setReduceMode] = useState<ReduceMode>('shares')

  // 补仓：只需输入金额，成本净值自动获取
  const [addAmount, setAddAmount] = useState('')
  const [latestNAV, setLatestNAV] = useState<number | null>(null)
  const [navLoading, setNavLoading] = useState(false)

  // 减仓字段
  const [reduceShares, setReduceShares] = useState('')
  const [reduceAmount, setReduceAmount] = useState('')
  const [reduceRatio, setReduceRatio] = useState('')

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 打开时自动获取最新净值
  useEffect(() => {
    if (open && fund) {
      setAction('add')
      setReduceMode('shares')
      setAddAmount('')
      setLatestNAV(null)
      setReduceShares('')
      setReduceAmount('')
      setReduceRatio('')
      setError('')
      setSaving(false)

      // 获取最新净值作为买入参考价
      setNavLoading(true)
      ;(async () => {
        try {
          const cached = await getQuotesCache([fund.code])
          const fromCache = cached?.quotes?.find((q) => q.code === fund.code)
          if (fromCache?.nav) { setLatestNAV(fromCache.nav); setNavLoading(false); return }
          const quotes = await dataSourceService.fetchQuotes([fund.code])
          const q = quotes.find((quote) => quote.code === fund.code)
          if (q?.nav) setLatestNAV(q.nav)
        } catch { /* ignore */ }
        setNavLoading(false)
      })()
    }
  }, [open, fund])

  // 计算实际要调整的份额
  const resolved = useMemo(() => {
    if (!fund) return { shares: 0, price: 0, isAdd: true }
    const currentShares = fund.shares || 0
    const currentCostNAV = fund.costNAV || 0

    if (action === 'add') {
      const price = latestNAV || currentCostNAV
      if (Number(addAmount) > 0) {
        return { shares: Number(addAmount) / price, price, isAdd: true }
      }
      return { shares: 0, price, isAdd: true }
    }

    // reduce
    if (reduceMode === 'shares') {
      return { shares: -(Number(reduceShares) || 0), price: currentCostNAV, isAdd: false }
    }
    if (reduceMode === 'amount' && Number(reduceAmount) > 0) {
      return { shares: -(Number(reduceAmount) / currentCostNAV), price: currentCostNAV, isAdd: false }
    }
    const ratio = Number(reduceRatio)
    if (ratio > 0) {
      return { shares: -(currentShares * ratio), price: currentCostNAV, isAdd: false }
    }
    return { shares: 0, price: currentCostNAV, isAdd: false }
  }, [fund, action, reduceMode, addAmount, latestNAV, reduceShares, reduceAmount, reduceRatio])

  const handleSave = async () => {
    if (!fund) return
    const adjustShares = Math.abs(resolved.shares)
    if (!adjustShares || adjustShares <= 0) { setError('请填写有效数值'); return }

    const currentShares = fund.shares || 0
    const currentCostNAV = fund.costNAV || 0
    const currentAmount = fund.holdingAmount || 0

    if (!resolved.isAdd && adjustShares > currentShares) {
      setError(`当前仅有 ${currentShares.toFixed(2)} 份`)
      return
    }

    setSaving(true); setError('')

    try {
      if (resolved.isAdd) {
        const price = resolved.price
        const newShares = currentShares + adjustShares
        const newCostNAV = currentShares > 0
          ? ((currentCostNAV * currentShares) + (price * adjustShares)) / newShares
          : price
        await updateHolding(fund.id, {
          shares: newShares,
          costNAV: newCostNAV,
          holdingAmount: currentAmount + (price * adjustShares),
        })
      } else {
        const ratio = (currentShares - adjustShares) / currentShares
        await updateHolding(fund.id, {
          shares: currentShares - adjustShares,
          holdingAmount: currentAmount * ratio,
        })
      }
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    }
    setSaving(false)
  }

  if (!fund) return null

  const currentShares = fund.shares || 0
  const currentCostNAV = fund.costNAV || 0

  const isAdd = action === 'add'
  const adjustShares = Math.abs(resolved.shares)
  const resultShares = isAdd ? currentShares + adjustShares : Math.max(0, currentShares - adjustShares)
  const resultCostNAV = isAdd && currentShares + adjustShares > 0
    ? ((currentCostNAV * currentShares) + (resolved.price * adjustShares)) / (currentShares + adjustShares)
    : currentCostNAV

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate">{isAdd ? '补仓' : '减仓'} — {fund.name || fund.code}</DialogTitle>
          <DialogDescription>
            当前持有 {currentShares.toFixed(2)} 份，成本 ¥{currentCostNAV.toFixed(4)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-0">
          {/* 操作选择 */}
          <div className="flex gap-2 mb-3">
            <Button
              variant={isAdd ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => setAction('add')}
            >
              <TrendingUp className="h-3 w-3 mr-1 text-green-500" />补仓
            </Button>
            <Button
              variant={!isAdd ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => setAction('reduce')}
            >
              <TrendingDown className="h-3 w-3 mr-1 text-red-500" />减仓
            </Button>
          </div>

          {/* 动态内容区 — flex-1 保证撑满，按钮始终在底部 */}
          <div className="flex flex-col min-h-[210px]">
            <div className="flex-1 space-y-3">
              {/* ── 补仓：只输金额，净值自动获取 ── */}
              {isAdd && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">买入金额 (¥)</Label>
                    <Input type="number" step="0.01" min="0" value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      placeholder="例: 100" className="h-8 text-sm" />
                  </div>

                  {/* 自动获取的净值参考 */}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5">
                    <span>买入参考净值</span>
                    {navLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : latestNAV ? (
                      <span className="font-mono font-medium">¥{latestNAV.toFixed(4)}</span>
                    ) : (
                      <span className="font-mono font-medium">¥{currentCostNAV.toFixed(4)}（持仓成本）</span>
                    )}
                    {Number(addAmount) > 0 && latestNAV && (
                      <span className="ml-auto">≈ {(Number(addAmount) / latestNAV).toFixed(2)} 份</span>
                    )}
                  </div>

                  {/* 手动覆盖净值 */}
                  {latestNAV && (
                    <details className="text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">自定义买入价格</summary>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        如需以特定价格成交，请修改以下数值。留空即使用参考净值 ¥{latestNAV.toFixed(4)}。
                      </p>
                    </details>
                  )}
                </>
              )}

              {/* ── 减仓输入 ── */}
              {!isAdd && (
                <>
                  <div className="flex gap-1">
                    <button
                      className={`text-[10px] px-2 py-1 rounded cursor-pointer transition-colors ${reduceMode === 'shares' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
                      onClick={() => setReduceMode('shares')}
                    >按份额</button>
                    <button
                      className={`text-[10px] px-2 py-1 rounded cursor-pointer transition-colors ${reduceMode === 'amount' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
                      onClick={() => setReduceMode('amount')}
                    >按金额</button>
                    <button
                      className={`text-[10px] px-2 py-1 rounded cursor-pointer transition-colors ${reduceMode === 'ratio' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
                      onClick={() => setReduceMode('ratio')}
                    >按比例</button>
                  </div>

                  {reduceMode === 'shares' && (
                    <div className="space-y-1">
                      <Label className="text-xs">卖出份额</Label>
                      <Input type="number" step="0.01" min="0" value={reduceShares}
                        onChange={(e) => setReduceShares(e.target.value)} placeholder={`最多 ${currentShares.toFixed(2)} 份`}
                        className="h-8 text-sm" />
                    </div>
                  )}

                  {reduceMode === 'amount' && (
                    <div className="space-y-1">
                      <Label className="text-xs">卖出金额 (¥)</Label>
                      <Input type="number" step="0.01" min="0" value={reduceAmount}
                        onChange={(e) => setReduceAmount(e.target.value)}
                        placeholder={`最多 ¥${(currentShares * currentCostNAV).toFixed(2)}`}
                        className="h-8 text-sm" />
                      {Number(reduceAmount) > 0 && (
                        <p className="text-[10px] text-muted-foreground">≈ {(Number(reduceAmount) / currentCostNAV).toFixed(2)} 份</p>
                      )}
                    </div>
                  )}

                  {reduceMode === 'ratio' && (
                    <div className="space-y-2">
                      <Label className="text-xs">卖出比例</Label>
                      <div className="flex gap-1 flex-wrap">
                        {RATIO_PRESETS.map((p) => (
                          <button key={p.value}
                            className={`text-[10px] px-2 py-1 rounded cursor-pointer transition-colors ${
                              Math.abs(Number(reduceRatio) - p.value) < 0.001
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted hover:bg-muted/70'
                            }`}
                            onClick={() => setReduceRatio(String(p.value))}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <Input type="number" step="0.01" min="0" max="1" value={Number(reduceRatio) > 0 ? reduceRatio : ''}
                        onChange={(e) => setReduceRatio(e.target.value)}
                        placeholder="自定义比例 (0~1)"
                        className="h-7 text-xs" />
                      {Number(reduceRatio) > 0 && (
                        <p className="text-[10px] text-muted-foreground">≈ {(currentShares * Number(reduceRatio)).toFixed(2)} 份</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* 结果预览 */}
              {adjustShares > 0 && (
                <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 space-y-0.5">
                  {isAdd ? (
                    <>
                      <p>补仓后: <strong>{resultShares.toFixed(2)}</strong> 份</p>
                      <p>加权成本: ¥<strong>{resultCostNAV.toFixed(4)}</strong></p>
                    </>
                  ) : (
                    <>
                      <p>减仓后: <strong>{resultShares.toFixed(2)}</strong> 份</p>
                      <p>剩余市值: ¥<strong>{(fund.holdingAmount || currentCostNAV * currentShares) * Math.max(resultShares, 0) / Math.max(currentShares, 1)}</strong></p>
                    </>
                  )}
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{error}
                </p>
              )}
            </div>

            {/* 底部按钮 — 始终固定在底部 */}
            <div className="flex gap-2 justify-end pt-3 mt-3 border-t">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !adjustShares}>
                {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />处理中</> : (
                  <>{isAdd ? <Plus className="h-3 w-3 mr-1" /> : <Minus className="h-3 w-3 mr-1" />}
                  {isAdd ? '确认补仓' : '确认减仓'}</>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
