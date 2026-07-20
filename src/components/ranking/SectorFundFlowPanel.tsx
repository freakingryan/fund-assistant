/**
 * 全市场板块资金流面板
 * 嵌入「综合评分排行榜 / 评分与资金流」页，展示主力净流入 TOP（吸金）与
 * 主力净流出 TOP（出逃）板块。支持行业/概念切换、今日/3日/5日/10日周期切换。
 * 数据来自 stock-sdk 的板块资金流排行，受东财增强开关门控。
 *
 * @module ranking/SectorFundFlowPanel
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Loader2, RefreshCw, TrendingDown, TrendingUp, Coins } from 'lucide-react'
import type { SectorFundFlowItem } from 'stock-sdk'
import {
  EastmoneyDisabledError,
  fetchSectorFundFlowRank,
  FLOW_INDICATOR_LABELS,
  FLOW_TYPE_LABELS,
  type FlowIndicator,
  type SectorFlowType,
} from '@/services/sectorFundFlowRank'
import { formatMoneyCompact } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const TOP_N = 8
const SECTOR_TYPES: SectorFlowType[] = ['industry', 'concept']
const INDICATORS: FlowIndicator[] = ['today', '3day', '5day', '10day']

interface Row {
  item: SectorFundFlowItem
  rank: number
}

function moneyColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground'
  return v >= 0 ? 'text-up' : 'text-down'
}

function changeColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground'
  return v >= 0 ? 'text-up' : 'text-down'
}

function FlowRow({ row, kind }: { row: Row; kind: 'in' | 'out' }) {
  const { item, rank } = row
  const inflow = item.mainNetInflow ?? 0
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40">
      <span className="w-5 text-center text-[11px] font-mono text-muted-foreground">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{item.code}</div>
      </div>
      <div className="text-right">
        <div className={`text-xs font-mono font-semibold ${moneyColor(item.mainNetInflow)}`}>
          {formatMoneyCompact(inflow)}
        </div>
        <div className={`text-[10px] font-mono ${changeColor(item.changePercent)}`}>
          {item.changePercent == null ? '-' : `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
          {item.mainNetInflowPercent != null && (
            <span className="ml-1 text-muted-foreground">({item.mainNetInflowPercent >= 0 ? '+' : ''}{item.mainNetInflowPercent.toFixed(1)}%)</span>
          )}
        </div>
      </div>
      {kind === 'in' ? (
        <ArrowUpRight className="h-3.5 w-3.5 text-up shrink-0" />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5 text-down shrink-0" />
      )}
    </li>
  )
}

export default function SectorFundFlowPanel() {
  const [sectorType, setSectorType] = useState<SectorFlowType>('industry')
  const [indicator, setIndicator] = useState<FlowIndicator>('today')
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SectorFundFlowItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDisabled(false)
    try {
      const items = await fetchSectorFundFlowRank({ sectorType, indicator })
      setData(items)
    } catch (e) {
      if (e instanceof EastmoneyDisabledError) {
        setDisabled(true)
        setData([])
      } else {
        setError('板块资金流获取失败')
        setData([])
      }
    }
    setLoading(false)
  }, [sectorType, indicator])

  useEffect(() => {
    load()
  }, [load])

  const topIn = data.slice(0, TOP_N).map((item, i) => ({ item, rank: i + 1 }))
  const topOut = data
    .slice(-TOP_N)
    .reverse()
    .map((item, i) => ({ item, rank: i + 1 }))

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Coins className="h-3.5 w-3.5 text-primary" />
          全市场板块资金流
          <span className="text-[10px] font-normal text-muted-foreground ml-1">主力净流入 · 东财增强</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 控制条 */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1 flex-wrap">
            {SECTOR_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setSectorType(t)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  sectorType === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted'
                }`}
              >
                {FLOW_TYPE_LABELS[t]}
              </button>
            ))}
            <span className="w-px h-3.5 bg-border/60 mx-0.5" />
            {INDICATORS.map((ind) => (
              <button
                key={ind}
                onClick={() => setIndicator(ind)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  indicator === ind
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted'
                }`}
              >
                {FLOW_INDICATOR_LABELS[ind]}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading || disabled}>
            {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            刷新
          </Button>
        </div>

        {disabled ? (
          <div className="text-center py-10 space-y-2">
            <Coins className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">板块资金流需到「设置 → 数据源」开启东财增强后展示</p>
          </div>
        ) : error ? (
          <div className="text-center py-10 text-sm text-down">{error}</div>
        ) : loading && data.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {/* 主力净流入 TOP */}
            <div className="rounded-lg border border-up/20 bg-up/5">
              <div className="px-3 py-2 flex items-center gap-1.5 text-up border-b border-up/20">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">主力净流入 TOP {TOP_N}</span>
              </div>
              <ul className="py-1">
                {topIn.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无数据</li>
                ) : (
                  topIn.map((row) => <FlowRow key={row.item.code} row={row} kind="in" />)
                )}
              </ul>
            </div>
            {/* 主力净流出 TOP */}
            <div className="rounded-lg border border-down/20 bg-down/5">
              <div className="px-3 py-2 flex items-center gap-1.5 text-down border-b border-down/20">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">主力净流出 TOP {TOP_N}</span>
              </div>
              <ul className="py-1">
                {topOut.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无数据</li>
                ) : (
                  topOut.map((row) => <FlowRow key={row.item.code} row={row} kind="out" />)
                )}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
