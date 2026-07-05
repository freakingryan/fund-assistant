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
      if (sortBy === 'pnl') return b.pnl - a.pnl
      if (sortBy === 'change') {
        const ca = a.quote?.dailyChange ?? 0
        const cb = b.quote?.dailyChange ?? 0
        return cb - ca
      }
      return b.mv - a.mv
    })

    return list
  }, [holdings, valuations, sortBy])

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
            <div className="flex gap-1">
              {(['value', 'pnl', 'change'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                    sortBy === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {key === 'value' ? '市值' : key === 'pnl' ? '盈亏' : '涨跌'}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* 列标题 */}
        <div className="hidden sm:flex items-center px-4 py-1.5 text-[10px] text-muted-foreground border-b">
          <div className="flex-1" />
          <div className="w-[90px] text-right shrink-0">最新价</div>
          <div className="w-[64px] text-right shrink-0">涨跌幅</div>
          <div className="w-[100px] text-right shrink-0">盈亏</div>
          <div className="w-[80px] text-right shrink-0">市值</div>
        </div>
        <div className="divide-y">
          {sorted.map(({ holding, quote, mv, pnl, pnlRate, loading: itemLoading }) => {
            const isProfit = pnl >= 0
            const isUp = (quote?.dailyChange ?? 0) >= 0
            return (
              <div
                key={holding.id}
                onClick={() => navigate(`/detail/${holding.id}`)}
                className="flex items-center px-4 py-2 text-xs hover:bg-muted/40 cursor-pointer transition-colors"
              >
                {/* 名称 + 代码 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-medium truncate">{holding.name || holding.code}</span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{holding.code}</span>
                  </div>
                </div>

                {/* 最新价 */}
                <div className="w-[90px] text-right shrink-0">
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
                <div className="w-[64px] text-right shrink-0">
                  {quote && (
                    <span className={`font-mono ${isUp ? 'text-red-500' : 'text-green-500'}`}>
                      {quote.dailyChange >= 0 ? '+' : ''}{quote.dailyChange.toFixed(2)}%
                    </span>
                  )}
                </div>

                {/* 盈亏 */}
                <div className="w-[100px] text-right shrink-0 whitespace-nowrap">
                  <span className={`font-mono ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    {pnl >= 0 ? '+' : '-'}¥{Math.abs(pnl).toFixed(2)}
                  </span>
                  <span className={`font-mono text-[10px] ml-1 ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    ({pnlRate >= 0 ? '+' : ''}{pnlRate.toFixed(2)}%)
                  </span>
                </div>

                {/* 市值标签 */}
                <div className="w-[80px] text-right shrink-0 text-muted-foreground">
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
