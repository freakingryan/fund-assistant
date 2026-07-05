/**
 * RealtimePanel — Dashboard 实时行情面板
 *
 * 展示所有持仓的实时估值，按 ETF 映射优先获取实时行情。
 * 数据来源：stock-api（内置）→ EastMoney 自动兜底
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes'
import type { FundHolding } from '@/types'
import { TrendingUp, RefreshCw } from 'lucide-react'

interface Props {
  holdings: FundHolding[]
}

function calcCost(h: FundHolding): number {
  if (h.costNAV && h.shares) return h.costNAV * h.shares
  if (h.holdingAmount != null && h.holdingProfit != null) return h.holdingAmount - h.holdingProfit
  return 0
}

export default function RealtimePanel({ holdings }: Props) {
  const navigate = useNavigate()
  const codes = useMemo(() => holdings.map((h) => h.code), [holdings])
  const { valuations, refresh, loading, lastUpdated } = useRealtimeQuotes(codes, 0)
  const [sortBy, setSortBy] = useState<'pnl' | 'change' | 'value'>('value')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const handleSort = (key: 'pnl' | 'change' | 'value') => {
    if (sortBy === key) {
      // 同一列：切换排序方向
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      // 不同列：设为降序
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    const list = holdings.map((h) => {
      const val = valuations[h.code]
      const quote = val?.quote
      const cost = calcCost(h)
      const mv = (quote && h.shares) ? h.shares * quote.nav : (h.holdingAmount || cost)
      const pnl = mv - cost
      const pnlRate = cost > 0 ? (pnl / cost) * 100 : 0
      return { holding: h, quote, mv, pnl, pnlRate, loading: val?.loading ?? false }
    })

    list.sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1
      let cmp: number
      if (sortBy === 'pnl') {
        cmp = a.pnl - b.pnl
      } else if (sortBy === 'change') {
        cmp = (a.quote?.dailyChange ?? 0) - (b.quote?.dailyChange ?? 0)
      } else {
        cmp = a.mv - b.mv
      }
      return cmp * dir
    })

    return list
  }, [holdings, valuations, sortBy, sortDir])

  const totalMV = sorted.reduce((s, i) => s + i.mv, 0)
  const totalCost = sorted.reduce((s, i) => s + calcCost(i.holding), 0)
  const totalPnl = totalMV - totalCost

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />
            实时持仓概览
            {lastUpdated && (
              <span className="text-[10px] text-muted-foreground font-normal">
                更新于 {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* 可排序列标题 */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 text-[10px] text-muted-foreground border-b">
          <div className="flex-1" />
          <div className="w-[96px] text-right shrink-0">最新价</div>
          <SortHeader label="涨跌幅" width="w-[80px]" active={sortBy === 'change'} dir={sortDir} onClick={() => handleSort('change')} />
          <SortHeader label="盈亏" width="w-[140px]" active={sortBy === 'pnl'} dir={sortDir} onClick={() => handleSort('pnl')} />
          <SortHeader label="持仓市值" width="w-[96px]" active={sortBy === 'value'} dir={sortDir} onClick={() => handleSort('value')} />
        </div>
        <div className="divide-y overflow-x-auto">
          {sorted.map(({ holding, quote, mv, pnl, pnlRate, loading: itemLoading }) => {
            const isProfit = pnl >= 0
            const isUp = (quote?.dailyChange ?? 0) >= 0
            return (
              <div
                key={holding.id}
                onClick={() => navigate(`/detail/${holding.id}`)}
                className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-muted/40 cursor-pointer transition-colors"
              >
                {/* 名称 + 代码 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-medium truncate">{holding.name || holding.code}</span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{holding.code}</span>
                  </div>
                </div>

                {/* 最新价 */}
                <div className="w-[96px] text-right shrink-0">
                  {itemLoading ? (
                    <span className="text-muted-foreground">加载中...</span>
                  ) : quote ? (
                    <span className={`font-mono font-medium ${isUp ? 'text-red-500' : 'text-green-500'}`}>
                      ¥{quote.nav.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>

                {/* 涨跌幅 */}
                <div className="w-[80px] text-right shrink-0">
                  {quote && (
                    <span className={`font-mono ${isUp ? 'text-red-500' : 'text-green-500'}`}>
                      {quote.dailyChange >= 0 ? '+' : ''}{quote.dailyChange.toFixed(2)}%
                    </span>
                  )}
                </div>

                {/* 盈亏 */}
                <div className="w-[140px] text-right shrink-0 whitespace-nowrap">
                  <span className={`font-mono ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    {pnl >= 0 ? '+' : '-'}¥{Math.abs(pnl).toFixed(2)}
                  </span>
                  <span className={`font-mono text-[10px] ml-1 ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    ({pnlRate >= 0 ? '+' : ''}{pnlRate.toFixed(2)}%)
                  </span>
                </div>

                {/* 持仓市值标签 */}
                <div className="w-[96px] text-right shrink-0 text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    ¥{mv.toFixed(0)}
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>

        {/* 汇总行 */}
        <div className="px-4 py-2.5 border-t bg-muted/20 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {holdings.length} 只基金
          </span>
          <div className="flex items-center gap-4">
            <span>
              总成本: <span className="font-mono">¥{totalCost.toFixed(2)}</span>
            </span>
            <span className={totalPnl >= 0 ? 'text-red-500' : 'text-green-500'}>
              总盈亏: <span className="font-mono font-medium">
                {totalPnl >= 0 ? '+' : ''}¥{totalPnl.toFixed(2)}
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** 可点击的排序列标题 */
function SortHeader({ label, width, active, dir, onClick }: { label: string; width: string; active: boolean; dir: 'desc' | 'asc'; onClick: () => void }) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`${width} text-right shrink-0 cursor-pointer select-none transition-colors inline-flex items-center justify-end gap-0.5 ${
        active ? 'text-foreground font-medium' : 'hover:text-foreground'
      }`}
      title={`按${label}${dir === 'desc' ? '从高到低' : '从低到高'}排序`}
    >
      <span className="truncate">{label}</span>
      {active && (
        <span className="text-[10px] opacity-70 leading-none">{dir === 'desc' ? '▼' : '▲'}</span>
      )}
    </div>
  )
}
