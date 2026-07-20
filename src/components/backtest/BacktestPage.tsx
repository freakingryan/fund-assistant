/**
 * 评分回测页
 * 工具栏（记录今日全持仓评分 / 回填次日涨跌 / 导出 CSV / 导出 JSON）
 * + 统计汇总行 + 图表（评分-次日涨跌散点 / 评分区间命中率）
 * + 明细表（可按基金/建议/结果筛选）。
 *
 * @module backtest/BacktestPage
 */

import { useEffect, useMemo, useState, useCallback, Fragment, useRef } from 'react'
import { captureDailySnapshots, reconcileSnapshots, getAllSnapshots, localDateKey } from '@/services/backtest/decisionSnapshot'
import { computeBacktestStats, computeDailyAccuracySeries, recommendationLabel, outcomeLabel } from '@/services/backtest/stats'
import type { Recommendation, ScoreSnapshot } from '@/services/backtest/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, BarChart3, Download, RefreshCw, Camera } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import ScoreScatterChart from './ScoreScatterChart'
import AccuracyBucketChart from './AccuracyBucketChart'
import DailyAccuracyTrendChart from './DailyAccuracyTrendChart'
import AiAnalysisPanel from './AiAnalysisPanel'

const REC_COLOR: Record<Recommendation, string> = {
  buy: 'text-up bg-up/10 border-up/30',
  hold: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  sell: 'text-down bg-down/10 border-down/30',
}
const OUTCOME_COLOR: Record<ScoreSnapshot['outcome'], string> = {
  pending: 'text-muted-foreground bg-muted/40 border-border/40',
  correct: 'text-up bg-up/10 border-up/30',
  wrong: 'text-down bg-down/10 border-down/30',
  neutral: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  unknown: 'text-muted-foreground bg-muted/40 border-border/40',
}

function fmtPct(v: number | null): string {
  if (v == null) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtRate(v: number | null): string {
  if (v == null) return '-'
  return `${(v * 100).toFixed(1)}%`
}

export default function BacktestPage() {
  const [snapshots, setSnapshots] = useState<ScoreSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<null | 'capture' | 'reconcile'>(null)
  const [recFilter, setRecFilter] = useState<'all' | Recommendation>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | ScoreSnapshot['outcome']>('all')
  const [dateFilter, setDateFilter] = useState<'all' | string>('all')
  // 首次加载后将明细默认聚焦「当日」（无当日数据则回退到最近一个交易日），而非全部日期平铺
  const initialDateSet = useRef(false)

  const load = useCallback(async () => {
    const data = await getAllSnapshots()
    setSnapshots(data)
    if (!initialDateSet.current) {
      const set = new Set(data.map((s) => s.date))
      const today = localDateKey()
      const latest = Array.from(set).sort((a, b) => (a < b ? 1 : -1))[0]
      setDateFilter(set.has(today) ? today : (latest ?? 'all'))
      initialDateSet.current = true
    }
    setLoading(false)
  }, [])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const stats = useMemo(() => computeBacktestStats(snapshots), [snapshots])
  const daily = useMemo(() => computeDailyAccuracySeries(snapshots), [snapshots])

  // 明细表日期筛选选项：全部有快照的交易日（降序）
  const dateOptions = useMemo(() => {
    const set = new Set(snapshots.map((s) => s.date))
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1))
  }, [snapshots])

  const filtered = useMemo(
    () => snapshots.filter(
      (s) => (recFilter === 'all' || s.recommendation === recFilter)
        && (outcomeFilter === 'all' || s.outcome === outcomeFilter)
        && (dateFilter === 'all' || s.date === dateFilter),
    ),
    [snapshots, recFilter, outcomeFilter, dateFilter],
  )

  // 明细表按日期分组（降序），便于「按日期浏览」而非所有日期平铺一页
  const groupedByDate = useMemo(() => {
    const map = new Map<string, ScoreSnapshot[]>()
    for (const s of filtered) {
      const arr = map.get(s.date)
      if (arr) arr.push(s)
      else map.set(s.date, [s])
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, rows]) => ({ date, rows }))
  }, [filtered])

  // 是否存在「ETF/个股类且仍待回填」的快照——用于针对性提示时间差成因
  const hasPendingEtf = useMemo(
    () => snapshots.some((s) => s.outcome === 'pending' && s.valueSource === 'etf'),
    [snapshots],
  )

  const handleCapture = async () => {
    setBusy('capture')
    try {
      const n = await captureDailySnapshots(true)
      toast({ type: 'success', message: n > 0 ? `已记录 ${n} 只基金今日评分` : '今日评分已存在或无可用 K 线数据' })
      await load()
    } catch {
      toast({ type: 'error', message: '采集失败' })
    }
    setBusy(null)
  }

  const handleReconcile = async () => {
    setBusy('reconcile')
    try {
      const n = await reconcileSnapshots()
      toast({ type: 'success', message: n > 0 ? `已回填 ${n} 条次日涨跌` : '暂无可回填数据' })
      await load()
    } catch {
      toast({ type: 'error', message: '回填失败' })
    }
    setBusy(null)
  }

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(snapshots, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `score-backtest-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    const header = ['日期', '基金代码', '基金名称', '评分', '评级', '建议', '收盘值', '来源', '次日日期', '次日涨跌%', '结果', '多空比', '冲突']
    const rows = snapshots.map((s) => [
      s.date, s.fundCode, s.fundName, s.score, s.ratingLabel, recommendationLabel(s.recommendation),
      s.closeValue ?? '', s.valueSource, s.nextDate ?? '', s.nextChangePct?.toFixed(2) ?? '', outcomeLabel(s.outcome),
      s.bullRatio.toFixed(2), s.conflict ? '是' : '否',
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `score-backtest-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">评分回测验证</h1>
          <p className="text-sm text-muted-foreground mt-1">
            记录每日收盘评分，回填次日实际涨跌，验证决策引擎准确率
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleCapture} disabled={busy !== null}>
            {busy === 'capture' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Camera className="h-3 w-3 mr-1" />}
            记录今日评分
          </Button>
          <Button size="sm" variant="outline" onClick={handleReconcile} disabled={busy !== null}>
            {busy === 'reconcile' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            回填次日涨跌
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={snapshots.length === 0}>
            <Download className="h-3 w-3 mr-1" />CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportJson} disabled={snapshots.length === 0}>
            <Download className="h-3 w-3 mr-1" />JSON
          </Button>
        </div>
      </div>

      {/* 统计汇总行 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="快照总数" value={`${stats.total}`} sub={`已回填 ${stats.settled}`} />
        <StatCard label="方向性准确率" value={fmtRate(stats.directionalAccuracy)} sub={`${stats.directionalCorrect}/${stats.directionalTotal} 命中`} highlight />
        <StatCard label="买入命中率" value={fmtRate(stats.buyHitRate)} sub={`${stats.buyHits}/${stats.buyTotal}`} />
        <StatCard label="卖出命中率" value={fmtRate(stats.sellHitRate)} sub={`${stats.sellHits}/${stats.sellTotal}`} />
      </div>

      {stats.total > 0 && stats.settled === 0 && (
        <div className="text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded px-3 py-2">
          已记录评分但尚未回填次日涨跌。点击「回填次日涨跌」或在次日打开应用后自动回填。
          {stats.byRec.buy + stats.byRec.sell > 0 && ' 场内 ETF 类基金走腾讯真实 K 线，可正常回填；纯净值基金需部署 Cloudflare Worker 后方可取数。'}
        </div>
      )}

      {/* 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">评分 × 次日涨跌</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreScatterChart snapshots={snapshots} />
          </CardContent>
        </Card>
        <Card className="card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">各评分区间命中率</CardTitle>
          </CardHeader>
          <CardContent>
            <AccuracyBucketChart buckets={stats.buckets} />
          </CardContent>
        </Card>
      </div>

      {/* 每日方向性准确率趋势 */}
      <Card className="card-hover">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">每日方向性准确率趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyAccuracyTrendChart daily={daily} />
        </CardContent>
      </Card>

      {/* AI 辅助算法分析 */}
      <AiAnalysisPanel snapshots={snapshots} />

      {/* 明细表 */}
      <Card className="card-hover">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />评分快照明细
            </CardTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterGroup
                value={recFilter} onChange={setRecFilter}
                options={[['all', '全部建议'], ['buy', '买入'], ['hold', '持有'], ['sell', '卖出']] as const}
              />
              <FilterGroup
                value={outcomeFilter} onChange={setOutcomeFilter}
                options={[['all', '全部结果'], ['pending', '待回填'], ['correct', '命中'], ['wrong', '未命中'], ['neutral', '中性']] as const}
              />
              {dateOptions.length > 0 && (
                <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
                  <span className="text-[10px] text-muted-foreground">日期</span>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-border/50 bg-muted/40 text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[120px]"
                    title="按采集日期筛选明细"
                  >
                    <option value="all">全部日期</option>
                    {dateOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hasPendingEtf && (
            <p className="text-[10px] text-muted-foreground/80 mb-2 leading-relaxed">
              提示：ETF/个股类快照的「次日涨跌」需等下一交易日收盘后才有数据，故最近约 1 个交易日会显示「待回填」；
              而净值类基金因净值 T+1 公布，其快照的 asOfDate 通常比采集日早一天，故往往当日即可回填。两者均属正常时间差，并非数据缺失。
            </p>
          )}
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">
              {snapshots.length === 0 ? '暂无评分快照，点击「记录今日评分」开始积累数据' : '当前筛选无匹配记录'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-1.5 px-2">日期</th>
                    <th className="text-left font-medium py-1.5 px-2">基金</th>
                    <th className="text-right font-medium py-1.5 px-2">评分</th>
                    <th className="text-left font-medium py-1.5 px-2">建议</th>
                    <th className="text-right font-medium py-1.5 px-2">收盘值</th>
                    <th className="text-right font-medium py-1.5 px-2">次日涨跌</th>
                    <th className="text-left font-medium py-1.5 px-2">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByDate.map(({ date, rows }) => (
                    <Fragment key={date}>
                      <tr className="bg-muted/40">
                        <td colSpan={7} className="py-1 px-2 text-[11px] font-semibold text-foreground/90">
                          {date}
                          <span className="ml-2 text-[10px] font-normal text-muted-foreground">{rows.length} 只基金</span>
                        </td>
                      </tr>
                      {rows.map((s) => (
                        <tr key={s.id} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{s.date}</td>
                          <td className="py-1.5 px-2">
                            <div className="truncate max-w-[140px]">{s.fundName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{s.fundCode}</div>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono font-medium">{s.score}</td>
                          <td className="py-1.5 px-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${REC_COLOR[s.recommendation]}`}>
                              {recommendationLabel(s.recommendation)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {s.closeValue != null ? s.closeValue.toFixed(3) : '-'}
                            <span className="text-[9px] text-muted-foreground ml-1">{s.valueSource === 'etf' ? 'ETF' : s.valueSource === 'nav' ? '净值' : ''}</span>
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${s.nextChangePct != null ? (s.nextChangePct >= 0 ? 'text-up' : 'text-down') : 'text-muted-foreground'}`}>
                            {fmtPct(s.nextChangePct)}
                          </td>
                          <td className="py-1.5 px-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${OUTCOME_COLOR[s.outcome]}`}>
                              {outcomeLabel(s.outcome)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className="card-hover">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {label}
        </div>
        <p className={`text-xl font-bold tracking-tight ${highlight ? 'text-primary' : ''}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function FilterGroup<T extends string>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            value === val
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
