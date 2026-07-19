/**
 * 综合评分排行榜
 * 读取各基金最新评分快照，按决策引擎综合评分降序排列（买入红在前、减仓绿在后）。
 * 支持切换为按资金面分排序（需先在设置中开启东财资金面增强）。
 *
 * @module ranking/RankingPage
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, Camera, Loader2, TrendingUp, TrendingDown, Info, ChevronDown, AlertTriangle, HelpCircle } from 'lucide-react'
import { getAllSnapshots, captureDailySnapshots, getLatestCaptureReport, localDateKey } from '@/services/backtest/decisionSnapshot'
import type { CaptureReport, ScoreSnapshot } from '@/services/backtest/types'
import type { Rating } from '@/services/decision/types'
import { useHoldingsStore } from '@/stores/holdings'
import { useSettingsStore } from '@/stores/settings'
import type { FundHolding } from '@/types'
import { TYPE_LABELS } from '@/lib/labels'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

type Tone = 'up' | 'down' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  up: 'text-up bg-up/10 border-up/30',
  neutral: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  down: 'text-down bg-down/10 border-down/30',
}

function ratingTone(rating: Rating): Tone {
  if (rating === 'strong_buy' || rating === 'buy') return 'up'
  if (rating === 'hold') return 'neutral'
  return 'down'
}

function capitalTone(v: number | null | undefined): Tone | null {
  if (v == null) return null
  if (v >= 60) return 'up'
  if (v < 45) return 'down'
  return 'neutral'
}

function sectorTone(v: number | null | undefined): Tone | null {
  if (v == null) return null
  if (v >= 60) return 'up'
  if (v < 45) return 'down'
  return 'neutral'
}

/** 同类排名百分位色调：越小越好（前 25% 红 / 后 50% 绿 / 中间黄） */
function rankTone(v: number | null | undefined): Tone | null {
  if (v == null) return null
  if (v <= 25) return 'up'
  if (v > 50) return 'down'
  return 'neutral'
}

function fmtPct(v: number | null): string {
  if (v == null) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

/** 基于快照净值与持仓成本估算的浮盈浮亏（%，仅供参考） */
function calcReturnPct(snap: ScoreSnapshot, holding?: FundHolding): number | null {
  if (!holding || !holding.costNAV || holding.costNAV <= 0) return null
  if (snap.closeValue == null) return null
  return ((snap.closeValue - holding.costNAV) / holding.costNAV) * 100
}

export default function RankingPage() {
  const [allSnapshots, setAllSnapshots] = useState<ScoreSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sortBy, setSortBy] = useState<'score' | 'capital' | 'sector' | 'rank'>('score')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [report, setReport] = useState<CaptureReport | null>(null)

  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const navigate = useNavigate()
  const eastmoneyEnabled = useSettingsStore((s) => s.settings.dataSource.eastmoney.enabled)
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  const load = useCallback(async () => {
    const [data, rep] = await Promise.all([getAllSnapshots(), getLatestCaptureReport()])
    setAllSnapshots(data)
    setReport(rep)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadHoldings()
    loadSettings()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setLoading(false))
  }, [loadHoldings, loadSettings, load])

  // 每只基金取最新一次快照
  const latestByFund = useMemo(() => {
    const map = new Map<string, ScoreSnapshot>()
    for (const s of allSnapshots) {
      const existing = map.get(s.fundCode)
      if (!existing || s.date > existing.date) map.set(s.fundCode, s)
    }
    return Array.from(map.values())
  }, [allSnapshots])

  const holdingMap = useMemo(() => {
    const m = new Map<string, FundHolding>()
    for (const h of holdings) m.set(h.code, h)
    return m
  }, [holdings])

  // 今日缓存覆盖：已评 / 总数 / 缺失（与 captureDailySnapshots 的缓存跳过逻辑联动）
  const todayKey = localDateKey()
  const coverage = useMemo(() => {
    const todayCovered = new Set(
      allSnapshots.filter((s) => s.date === todayKey).map((s) => s.fundCode),
    )
    const total = holdings.length
    const covered = holdings.filter((h) => todayCovered.has(h.code)).length
    return { total, covered, missing: Math.max(0, total - covered) }
  }, [allSnapshots, holdings, todayKey])

  // 维度可用性仅取决于数据本身（与排序无关），用 latestByFund 避免与 ranked 形成依赖环
  const hasCapital = latestByFund.some((s) => s.capitalScore != null)
  const hasSector = latestByFund.some((s) => s.sectorScore != null)
  const hasRank = latestByFund.some((s) => s.rankPercentile != null)

  // 选中维度若已无数据（如东财关闭 / 快照被清空），effectiveSort 自动回退到综合评分，
  // 既保证“无数据维度无法被选中”，也避免按钮同时呈现“选中 + 禁用”的冲突态。
  const effectiveSort: 'score' | 'capital' | 'sector' | 'rank' =
    sortBy === 'capital' && !hasCapital
      ? 'score'
      : sortBy === 'sector' && !hasSector
      ? 'score'
      : sortBy === 'rank' && !hasRank
      ? 'score'
      : sortBy

  // 排序：综合评分降序（买入红在前），资金面分作 tie-break；
  // 切换为「资金面分」时，以 capitalScore 为主、score 为辅（null 沉底）；
  // 切换为「赛道分」时，以 sectorScore 为主、score 为辅（null 沉底）。
  const ranked = useMemo(() => {
    const arr = [...latestByFund]
    if (effectiveSort === 'capital') {
      return arr.sort((a, b) => {
        const ca = a.capitalScore ?? -Infinity
        const cb = b.capitalScore ?? -Infinity
        if (cb !== ca) return cb - ca
        return b.score - a.score
      })
    }
    if (effectiveSort === 'sector') {
      return arr.sort((a, b) => {
        const sa = a.sectorScore ?? -Infinity
        const sb = b.sectorScore ?? -Infinity
        if (sb !== sa) return sb - sa
        return b.score - a.score
      })
    }
    if (effectiveSort === 'rank') {
      // 同类排名百分位越小越好 → 升序，null 沉底；同值以综合评分为辅
      return arr.sort((a, b) => {
        const ra = a.rankPercentile ?? Infinity
        const rb = b.rankPercentile ?? Infinity
        if (ra !== rb) return ra - rb
        return b.score - a.score
      })
    }
    return arr.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ca = a.capitalScore ?? -Infinity
      const cb = b.capitalScore ?? -Infinity
      return cb - ca
    })
  }, [latestByFund, effectiveSort])

  const stats = useMemo(() => {
    let buy = 0
    let hold = 0
    let sell = 0
    let scoreSum = 0
    for (const s of ranked) {
      if (s.recommendation === 'buy') buy++
      else if (s.recommendation === 'hold') hold++
      else sell++
      scoreSum += s.score
    }
    return {
      total: ranked.length,
      buy,
      hold,
      sell,
      avg: ranked.length ? Math.round(scoreSum / ranked.length) : 0,
    }
  }, [ranked])

  // 未纳入评分的持仓：无快照 → 可能数据源不可达（东财净值 / 腾讯ETF K线）或尚未采集
  const missingFunds = useMemo(() => {
    const covered = new Set(latestByFund.map((s) => s.fundCode))
    const failuresByCode = new Map((report?.failures ?? []).map((f) => [f.code, f]))
    return holdings
      .filter((h) => !covered.has(h.code))
      .map((h) => {
        const f = failuresByCode.get(h.code)
        return {
          code: h.code,
          name: h.name || h.code,
          source: f?.source ?? null,
          reason: f?.reason ?? '今日尚未采集，点上方「更新今日评分」补评',
        }
      })
  }, [holdings, latestByFund, report])

  // 与缓存联动：仅补评当日缺失的持仓，已存在的直接跳过
  const handleCapture = async () => {
    setBusy(true)
    try {
      const n = await captureDailySnapshots({ force: true })
      await load()
      if (n > 0) toast({ type: 'success', message: `已更新 ${n} 只今日评分（含增强维度回填）` })
      else toast({ type: 'info', message: '今日评分已全部就绪' })
    } catch {
      toast({ type: 'error', message: '采集失败' })
    }
    setBusy(false)
  }

  // 强制重评：忽略缓存，覆盖全部持仓今日快照（需二次确认，避免无谓请求）
  const handleForceRefresh = async () => {
    if (busy) return
    const ok = window.confirm('将重新拉取全部持仓今日评分并覆盖已有结果，确认？')
    if (!ok) return
    setBusy(true)
    try {
      const n = await captureDailySnapshots({ force: true, reevaluate: true })
      await load()
      toast({ type: 'success', message: `已重评 ${n} 只今日评分` })
    } catch {
      toast({ type: 'error', message: '采集失败' })
    }
    setBusy(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const cols = 7 + (hasCapital ? 1 : 0) + (hasSector ? 1 : 0) + (hasRank ? 1 : 0)

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> 综合评分排行榜
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            按决策引擎综合评分排序，买入建议靠前、减仓建议靠后
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                coverage.missing === 0 ? 'bg-up' : 'bg-amber-500'
              }`}
            />
            今日已评 {coverage.covered}/{coverage.total}
          </span>
          <Button size="sm" variant="outline" onClick={handleCapture} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Camera className="h-3 w-3 mr-1" />}
            更新今日评分
            {coverage.missing > 0 && `（补 ${coverage.missing}）`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleForceRefresh}
            disabled={busy}
            title="忽略缓存，重新拉取并覆盖全部持仓今日评分"
          >
            重评全部
          </Button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="纳入排名" value={`${stats.total}`} sub="只基金" />
        <Stat label="建议买入" value={`${stats.buy}`} sub="评分靠前" up />
        <Stat label="建议减仓" value={`${stats.sell}`} sub="评分靠后" down />
        <Stat label="平均评分" value={`${stats.avg}`} sub={`持有 ${stats.hold} · 中性`} highlight />
      </div>

      {/* 未纳入评分：数据源不可达 / 尚未采集的基金（标注原因，回答"接口不可用如何影响评分"） */}
      {missingFunds.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />未纳入评分（{missingFunds.length} 只）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground mb-2">
              以下基金因数据源不可达或尚未采集，未出现在排名中（不影响已评分基金的排序）：
            </p>
            <ul className="space-y-1">
              {missingFunds.map((m) => (
                <li key={m.code} className="text-[11px] flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate max-w-[150px]">{m.name}</span>
                  <span className="font-mono text-muted-foreground">{m.code}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] ${
                      m.source === 'eastmoney'
                        ? 'text-down border-down/30 bg-down/10'
                        : m.source === 'tencent'
                        ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
                        : 'text-muted-foreground border-border/40'
                    }`}
                    title={m.reason}
                  >
                    {m.source === 'eastmoney' ? '东财不可达' : m.source === 'tencent' ? '腾讯K线失败' : '未采集'}
                  </span>
                  <span className="text-muted-foreground truncate">{m.reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 排序切换 + 增强维度提示 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
            排序：
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 opacity-60 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-left leading-relaxed">
                鼠标悬停每个排序按钮，查看其含义与排序方向（前三个分数越高越靠前；同类排名百分位越小越靠前）。
              </TooltipContent>
            </Tooltip>
          </span>
          <SortBtn active={effectiveSort === 'score'} onClick={() => setSortBy('score')} desc={
            <>
              <div className="font-semibold mb-0.5">综合评分</div>
              <div>决策引擎技术面综合分（趋势 / 乖离 / 动量 / 量能 / MACD / 形态）。</div>
              <div>排序：分数<b className="font-semibold">从高到低</b>，高分=偏买入排前、低分=减仓靠后；同分按资金面分兜底。</div>
            </>
          }>
            综合评分
          </SortBtn>
          <SortBtn
            active={effectiveSort === 'capital'}
            disabled={!hasCapital}
            hint={eastmoneyEnabled ? '今日快照暂无资金面数据，点「更新今日评分」回填' : '开启东财增强后可用'}
            onClick={() => hasCapital && setSortBy('capital')}
            desc={
              <>
                <div className="font-semibold mb-0.5">资金面分</div>
                <div>重仓股 / ETF 的主力资金净流入 + 北向资金，加权聚合（0–100）。</div>
                <div>排序：分数<b className="font-semibold">从高到低</b>，资金越净流入越靠前。</div>
                <div className="opacity-80">需开启东财增强；无数据沉底。</div>
              </>
            }
          >
            资金面分
          </SortBtn>
          <SortBtn
            active={effectiveSort === 'sector'}
            disabled={!hasSector}
            hint={eastmoneyEnabled ? '今日快照暂无赛道数据，点「更新今日评分」回填' : '开启东财增强后可用'}
            onClick={() => hasSector && setSortBy('sector')}
            desc={
              <>
                <div className="font-semibold mb-0.5">赛道分</div>
                <div>重仓股所属行业 + 概念板块当日涨跌幅，按持仓权重加权（0–100）。</div>
                <div>排序：分数<b className="font-semibold">从高到低</b>，踩中强势板块排前。</div>
                <div className="opacity-80">需开启东财增强；无数据沉底。</div>
              </>
            }
          >
            赛道分
          </SortBtn>
          <SortBtn
            active={effectiveSort === 'rank'}
            disabled={!hasRank}
            hint={eastmoneyEnabled ? '今日快照暂无同类排名数据，点「更新今日评分」回填' : '开启东财增强后可用'}
            onClick={() => hasRank && setSortBy('rank')}
            desc={
              <>
                <div className="font-semibold mb-0.5">同类排名</div>
                <div>东财官方同类近三月排名百分位（0–100，<b className="font-semibold">越小越好</b>）。</div>
                <div>排序：百分位<b className="font-semibold">从小到大</b>，前 12% 排最前、后 50% 沉底。</div>
                <div className="opacity-80">需开启东财增强；无数据沉底。</div>
              </>
            }
          >
            同类排名
          </SortBtn>
        </div>
        {(!hasCapital || !hasSector || !hasRank) && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            {eastmoneyEnabled
              ? '资金面 / 赛道 / 同类排名暂无数据，点「更新今日评分」回填（已开启东财增强）'
              : '资金面 / 赛道 / 同类排名需到「设置 → 数据源」开启东财增强后才会采集'}
          </p>
        )}
      </div>

      {/* 排行榜表 */}
      <Card className="card-hover">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" />持仓评分排名
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ranked.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Trophy className="h-12 w-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">暂无评分快照</p>
              <Button size="sm" variant="outline" onClick={handleCapture} disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Camera className="h-3 w-3 mr-1" />}
                更新今日评分
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-1.5 px-2 w-8">#</th>
                    <th className="text-left font-medium py-1.5 px-2">基金</th>
                    <th className="text-left font-medium py-1.5 px-2">类型</th>
                    <th className="text-right font-medium py-1.5 px-2">收益率*</th>
                    <th className="text-right font-medium py-1.5 px-2">综合评分</th>
                    <th className="text-left font-medium py-1.5 px-2">评级</th>
                    {hasCapital && <th className="text-right font-medium py-1.5 px-2">资金面分</th>}
                    {hasSector && <th className="text-right font-medium py-1.5 px-2">赛道分</th>}
                    {hasRank && <th className="text-right font-medium py-1.5 px-2">同类排名</th>}
                    <th className="text-right font-medium py-1.5 px-2 w-6" />
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((s, i) => {
                    const tone = ratingTone(s.rating)
                    const holding = holdingMap.get(s.fundCode)
                    const ret = calcReturnPct(s, holding)
                    const cap = capitalTone(s.capitalScore)
                    const sec = sectorTone(s.sectorScore)
                    const rnk = rankTone(s.rankPercentile)
                    const isOpen = expanded === s.id
                    const jumpId = holding?.id
                    return (
                      <Fragment key={s.id}>
                        <tr
                          className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setExpanded(isOpen ? null : s.id)}
                        >
                          <td className="py-2 px-2 text-muted-foreground font-mono">{i + 1}</td>
                          <td className="py-2 px-2">
                            <div className="truncate max-w-[160px] font-medium">
                              {jumpId ? (
                                <button
                                  className="hover:text-primary hover:underline truncate"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(`/detail/${jumpId}`)
                                  }}
                                >
                                  {s.fundName}
                                </button>
                              ) : (
                                s.fundName
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">{s.fundCode}</div>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">
                            {holding?.type ? (TYPE_LABELS[holding.type] ?? '-') : '-'}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-mono ${
                              ret == null
                                ? 'text-muted-foreground'
                                : ret >= 0
                                ? 'text-up'
                                : 'text-down'
                            }`}
                          >
                            {fmtPct(ret)}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span
                                className={`font-mono font-semibold ${
                                  tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-amber-500'
                                }`}
                              >
                                {s.score}
                              </span>
                              <span className="hidden sm:block h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                                <span
                                  className={`block h-full ${
                                    tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${s.score}%` }}
                                />
                              </span>
                            </div>
                            <div className="flex justify-end mt-1">
                              <SourceBadge snap={s} />
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${TONE_CLASS[tone]}`}>
                              {s.ratingLabel}
                            </span>
                          </td>
                          {hasCapital && (
                            <td
                              className={`py-2 px-2 text-right font-mono ${
                                cap
                                  ? cap === 'up'
                                    ? 'text-up'
                                    : cap === 'down'
                                    ? 'text-down'
                                    : 'text-amber-500'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {s.capitalScore == null ? (
                                <span
                                  title="资金面分需开启「东财资金面增强」（设置 → 数据源）；当前未开启或不可达"
                                  className="cursor-help"
                                >
                                  —
                                </span>
                              ) : (
                                s.capitalScore.toFixed(0)
                              )}
                            </td>
                          )}
                          {hasSector && (
                            <td
                              className={`py-2 px-2 text-right font-mono ${
                                sec
                                  ? sec === 'up'
                                    ? 'text-up'
                                    : sec === 'down'
                                    ? 'text-down'
                                    : 'text-amber-500'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {s.sectorScore == null ? (
                                <span
                                  title="赛道分需开启「东财资金面增强」（设置 → 数据源）；按重仓股/ETF 所属行业·概念板块当日强度加权"
                                  className="cursor-help"
                                >
                                  —
                                </span>
                              ) : (
                                s.sectorScore.toFixed(0)
                              )}
                            </td>
                          )}
                          {hasRank && (
                            <td
                              className={`py-2 px-2 text-right font-mono ${
                                rnk
                                  ? rnk === 'up'
                                    ? 'text-up'
                                    : rnk === 'down'
                                    ? 'text-down'
                                    : 'text-amber-500'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {s.rankPercentile == null ? (
                                <span
                                  title="同类排名需开启「东财资金面增强」（设置 → 数据源）；取东财同类近三月排名百分位，越小越好"
                                  className="cursor-help"
                                >
                                  —
                                </span>
                              ) : (
                                <span
                                  title={
                                    s.rankValue != null && s.rankTotal != null
                                      ? `同类近三月第 ${s.rankValue}/${s.rankTotal} 名（前 ${s.rankPercentile.toFixed(1)}%）`
                                      : `同类近三月排名百分位 ${s.rankPercentile.toFixed(1)}%（越小越好）`
                                  }
                                  className="cursor-help"
                                >
                                  前{s.rankPercentile.toFixed(0)}%
                                </span>
                              )}
                            </td>
                          )}
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            <ChevronDown
                              className={`h-4 w-4 inline transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            />
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/40 bg-muted/20">
                            <td colSpan={cols} className="px-3 py-3">
                              <ReasonBlock snap={s} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-2">
                * 收益率为基于快照净值与持仓成本的估算，仅供参考；点击行展开查看多空理由，点击基金名跳转详情。
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** 评分数据来源徽章：标注该评分依赖哪个数据源，及不可达时的后果 */
function SourceBadge({ snap }: { snap: ScoreSnapshot }) {
  const isEtf = snap.valueSource === 'etf'
  const label = isEtf ? '真实K线·腾讯' : '净值模式·东财'
  const cls = isEtf
    ? 'text-up border-up/30 bg-up/10'
    : 'text-amber-500 border-amber-500/30 bg-amber-500/10'
  const tip = isEtf
    ? '评分基于场内 ETF 真实 K 线（腾讯源，当前网络可达），指标置信度高'
    : '评分基于东财净值历史；你当前网络已实测可直连东财，纯净值基金可正常评分'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${cls}`} title={tip}>
      {label}
    </span>
  )
}

function ReasonBlock({ snap }: { snap: ScoreSnapshot }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{snap.summary}</p>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-medium text-up mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />买入理由
          </div>
          {snap.bullReasons.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">无</p>
          ) : (
            <ul className="space-y-0.5">
              {snap.bullReasons.map((r, i) => (
                <li key={i} className="text-[11px] text-foreground/80">
                  · {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[11px] font-medium text-down mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />风险因子
          </div>
          {snap.bearReasons.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">无</p>
          ) : (
            <ul className="space-y-0.5">
              {snap.bearReasons.map((r, i) => (
                <li key={i} className="text-[11px] text-foreground/80">
                  · {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {snap.rankPercentile != null && (
        <p className="text-[11px] text-muted-foreground">
          同类排名：
          <span className={rankTone(snap.rankPercentile) === 'up' ? 'text-up' : rankTone(snap.rankPercentile) === 'down' ? 'text-down' : 'text-amber-500'}>
            前 {snap.rankPercentile.toFixed(1)}%
          </span>
          {snap.rankValue != null && snap.rankTotal != null && (
            <span className="ml-1">（同类近三月第 {snap.rankValue}/{snap.rankTotal} 名）</span>
          )}
        </p>
      )}
      {snap.lowConfidence && (
        <p className="text-[10px] text-amber-500">
          基于净值走势（无盘中区间），指标置信度较低，建议切换 ETF 真实 K 线复核。
        </p>
      )}
      {snap.sectorBreakdown && snap.sectorBreakdown.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-1">板块赛道贡献（按重仓股权重）</div>
          <div className="flex flex-wrap gap-1.5">
            {snap.sectorBreakdown.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-muted/40"
                title={`行业 ${fmtPct(b.industryChangePercent)} · 概念 ${fmtPct(b.conceptChangePercent)}（权重 ${(b.weight * 100).toFixed(0)}%）`}
              >
                <span className="font-medium truncate max-w-[90px]">{b.name || b.symbol}</span>
                <span className={b.industryChangePercent != null && b.industryChangePercent >= 0 ? 'text-up' : 'text-down'}>
                  {fmtPct(b.industryChangePercent)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  highlight,
  up,
  down,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
  up?: boolean
  down?: boolean
}) {
  return (
    <Card className="card-hover">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <p
          className={`text-xl font-bold tracking-tight ${
            highlight ? 'text-primary' : up ? 'text-up' : down ? 'text-down' : ''
          }`}
        >
          {value}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function SortBtn({
  active,
  disabled,
  hint,
  desc,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  hint?: string
  desc?: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : undefined}
      className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : disabled
          ? 'bg-muted/20 text-muted-foreground/50 border-border/30 cursor-not-allowed'
          : 'bg-muted/40 text-muted-foreground border-border/40 hover:bg-muted'
      }`}
    >
      {children}
      {desc && <HelpCircle className="h-3 w-3 opacity-60" />}
      {disabled && hint && <span className="ml-0.5 text-[10px] opacity-70">（暂无）</span>}
    </button>
  )
  if (!desc) return btn
  // 用 span 包裹，确保按钮 disabled 时仍能悬停触发 tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={disabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>{btn}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-left leading-relaxed">
        {desc}
      </TooltipContent>
    </Tooltip>
  )
}
