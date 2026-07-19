/**
 * 同类排名走势卡片（东财增强，门控）
 *
 * 展示某只基金在「同类近三月」维度下的排名百分位走势：
 *   - 折线图：percentile(%) 随时间变化，Y 轴反向（越小越好 → 视觉越靠上越好）；
 *   - 顶部摘要：最新名次 rank/total 与百分位。
 *
 * 门控：仅当 settings.dataSource.eastmoney.enabled=true 才请求东财；
 *       未开启时显示引导提示，不产生任何请求。
 *
 * 颜色遵循 A 股惯例（涨红跌绿）：百分位越小（越靠前）越偏红。
 *
 * @module holdings/FundRankHistoryCard
 */

import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Award, Loader2, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchFundRankHistory, type FundRankHistoryResult } from '@/services/fundRankHistory'
import type { EastmoneyDataSourceConfig } from '@/types'

/** 百分位越小越好：≤25 红 / >50 绿 / 中间黄 */
function toneColor(pct: number | null | undefined): string {
  if (pct == null) return 'text-muted-foreground'
  if (pct <= 25) return 'text-up'
  if (pct > 50) return 'text-down'
  return 'text-amber-500'
}

function lineColor(pct: number | null | undefined): string {
  if (pct == null) return '#f59e0b'
  if (pct <= 25) return '#ef4444' // 红（靠前）
  if (pct > 50) return '#22c55e' // 绿（靠后）
  return '#f59e0b'
}

export default function FundRankHistoryCard({
  code,
  config,
}: {
  code: string
  config: EastmoneyDataSourceConfig
}) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FundRankHistoryResult | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!config.enabled || !code) {
      setData(null)
      setLoaded(true)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoaded(false)
    fetchFundRankHistory(code, config)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
          setLoaded(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, config])

  // 仅保留有 percentile 值的点用于绘图
  const chartData = useMemo(
    () =>
      (data?.items ?? [])
        .filter((p) => p.percentile != null)
        .map((p) => ({ date: p.date.slice(5), percentile: p.percentile as number, rank: p.rank, total: p.total })),
    [data],
  )

  const latest = data?.latest ?? null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Award className="h-3.5 w-3.5" />同类排名走势
          <span className="text-[10px] font-normal text-muted-foreground">近三月 · 东财</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!config.enabled ? (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground py-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              同类排名走势需开启东财增强。到「设置 → 数据源」打开「东财资金面增强」后，即可展示该基金在同类基金中的近三月排名走势。
            </span>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-[200px]">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || chartData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {loaded ? '暂无同类排名数据（东财未收录该基金排名或当前不可达）' : ''}
          </p>
        ) : (
          <div className="space-y-3">
            {/* 摘要 */}
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <span className="text-[10px] text-muted-foreground">最新百分位</span>
                <p className={`text-xl font-bold tracking-tight ${toneColor(latest?.percentile)}`}>
                  {latest?.percentile != null ? `前 ${latest.percentile.toFixed(1)}%` : '-'}
                </p>
              </div>
              {latest?.rank != null && latest?.total != null && (
                <div>
                  <span className="text-[10px] text-muted-foreground">同类名次</span>
                  <p className="text-sm font-medium">
                    第 <span className="font-mono">{latest.rank}</span>
                    <span className="text-muted-foreground"> / {latest.total}</span>
                  </p>
                </div>
              )}
            </div>

            {/* 走势图：Y 轴反向（越小越好 → 越靠上越好） */}
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis
                  domain={[0, 100]}
                  reversed
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <ReferenceLine y={50} strokeDasharray="4 4" className="stroke-muted-foreground/40" />
                <Tooltip
                  cursor={{ stroke: 'rgba(148,163,184,0.3)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const p = payload[0].payload as (typeof chartData)[number]
                    return (
                      <div className="rounded-md border bg-popover text-popover-foreground px-2 py-1.5 text-[10px] shadow-md">
                        <p className="font-medium">{p.date}</p>
                        <p>
                          同类百分位 <span className="font-mono">前 {p.percentile.toFixed(1)}%</span>
                        </p>
                        {p.rank != null && p.total != null && (
                          <p className="text-muted-foreground">
                            第 {p.rank} / {p.total} 名
                          </p>
                        )}
                      </div>
                    )
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="percentile"
                  stroke={lineColor(latest?.percentile)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground">
              纵轴为同类近三月排名百分位（越小越靠前，已反向显示：越靠上越好）；虚线为同类中位（前 50%）。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
