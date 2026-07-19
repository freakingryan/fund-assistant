/**
 * 评分回测概览卡片（仪表盘入口）
 * 展示方向性准确率 / 快照数，点击进入完整回测页。
 *
 * @module dashboard/BacktestSummaryCard
 */

import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Target, ChevronRight } from 'lucide-react'
import { getAllSnapshots } from '@/services/backtest/decisionSnapshot'
import { computeBacktestStats } from '@/services/backtest/stats'

export default function BacktestSummaryCard() {
  const navigate = useNavigate()
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [settled, setSettled] = useState(0)

  useEffect(() => {
    let cancelled = false
    getAllSnapshots().then((snaps) => {
      if (cancelled) return
      const stats = computeBacktestStats(snaps)
      setAccuracy(stats.directionalAccuracy)
      setTotal(stats.total)
      setSettled(stats.settled)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <Card
      className="card-hover cursor-pointer transition-colors hover:border-primary/40"
      onClick={() => navigate('/backtest')}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Target className="h-3.5 w-3.5" />评分回测
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-2xl font-bold tracking-tight mt-1">
          {accuracy == null ? '—' : `${(accuracy * 100).toFixed(1)}%`}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          方向性准确率 · 快照 {total}（已回填 {settled}）
        </p>
      </CardContent>
    </Card>
  )
}
