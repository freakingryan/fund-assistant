import { useEffect, useState } from 'react'
import { usePlansStore } from '@/stores/plans'
import { useHoldingsStore } from '@/stores/holdings'
import { generateDailyReport, getDailyReport, DAILY_REPORT_SCHEMA_VERSION } from '@/services/dailyReport'
import { localDateKey } from '@/services/backtest/decisionSnapshot'
import type {
  DailyReport,
  MarketSignalItem,
  PlanProgressItem,
  PlanRuleType,
  SectorTempItem,
} from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { formatCurrency, formatPercent, formatSigned, pnlColor } from '@/lib/format'
import {
  CalendarDays,
  RefreshCw,
  Loader2,
  TrendingUp,
  Copy,
  Sparkles,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowRight,
} from 'lucide-react'

const RULE_TYPE_LABELS: Record<PlanRuleType, string> = {
  return: '收益率',
  price_diff: '净值价差',
  daily_change: '单日涨跌幅',
  dca: '定期定投',
  kline_pattern: 'K 线形态',
  trend: '趋势信号',
}

const COMPARATOR_LABELS: Record<string, string> = { lt: '<', gt: '>', lte: '≤', gte: '≥' }

const STATUS_META: Record<PlanProgressItem['status'], { label: string; cls: string }> = {
  reached: { label: '已触发', cls: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  near: { label: '临近', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  far: { label: '较远', cls: 'bg-muted text-muted-foreground' },
  na: { label: '需逐只评估', cls: 'bg-muted text-muted-foreground' },
  disabled: { label: '已停用', cls: 'bg-muted text-muted-foreground' },
}

export default function DailyReportPage() {
  const plan = usePlansStore((s) => s.plan)
  const scan = usePlansStore((s) => s.scan)
  const loadPlan = usePlansStore((s) => s.loadPlan)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)

  const [report, setReport] = useState<DailyReport | null>(null)
  const [generating, setGenerating] = useState(false)
  const [holdingsReady, setHoldingsReady] = useState(false)

  useEffect(() => {
    loadPlan()
    loadAlerts()
    loadHoldings()
  }, [loadPlan, loadAlerts, loadHoldings])

  useEffect(() => {
    setHoldingsReady(true)
  }, [holdings])

  useEffect(() => {
    if (!holdingsReady) return
    if (report) return
    const today = localDateKey()
    getDailyReport(today).then((r) => {
      // 无日报，或旧版本（成本解析 bug）留下的陈旧快照 → 自动重算覆盖，避免持续显示「成本未知」
      if (!r || (r.schemaVersion ?? 0) < DAILY_REPORT_SCHEMA_VERSION) {
        if (holdings.length > 0) {
          generateDailyReport(holdings).then(setReport)
          return
        }
        setReport(null)
        return
      }
      setReport(r)
    })
  }, [holdingsReady, report, holdings])

  const handleGenerate = async () => {
    if (holdings.length === 0) {
      toast({ type: 'info', message: '请先在「持仓管理」添加基金' })
      return
    }
    setGenerating(true)
    try {
      // 日报依赖当日行动建议：若计划启用，先扫描触发提醒
      if (plan?.enabled) await scan(holdings)
      const r = await generateDailyReport(holdings)
      setReport(r)
      if (r) toast({ type: 'success', message: '今日日报已生成' })
      else toast({ type: 'info', message: '暂无持仓，无法生成日报' })
    } catch (e) {
      toast({ type: 'error', message: '日报生成失败：' + String(e) })
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!report) return
    const text = buildShareText(report)
    try {
      await navigator.clipboard.writeText(text)
      toast({ type: 'success', message: '日报文本已复制' })
    } catch {
      toast({ type: 'error', message: '复制失败，请手动选择' })
    }
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <Header onGenerate={handleGenerate} generating={generating} onCopy={handleCopy} canCopy={false} />
        <Card>
          <CardContent className="text-center py-12 space-y-3">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">今日还没有日报</p>
            <p className="text-xs text-muted-foreground/80">
              生成日报将聚合「组合盈亏 / 行动建议 / 计划进度 / 板块温度+信号」四个模块
            </p>
            <Button size="sm" onClick={handleGenerate} disabled={generating || holdings.length === 0}>
              {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
              生成今日日报
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const p = report.portfolio
  const buySuggestions = report.suggestions.filter((a) => a.action === 'buy')
  const sellSuggestions = report.suggestions.filter((a) => a.action === 'sell')

  return (
    <div className="space-y-6">
      <Header onGenerate={handleGenerate} generating={generating} onCopy={handleCopy} canCopy />

      {/* 顶部：今日盈亏大数字 */}
      <Card className="overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-muted-foreground">今日盈亏 · {report.date}</p>
              <p className={`text-3xl font-bold tracking-tight ${pnlColor(p.dayPnl)}`}>
                {formatSigned(p.dayPnl)}{formatCurrency(p.dayPnl)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                当日收益率 {formatPercent(p.dayPnlPct)}
                {p.dayPnlByPrev != null && (
                  <span className="ml-3">
                    较昨日市值{formatSigned(p.dayPnlByPrev)}
                    {formatCurrency(p.dayPnlByPrev)}
                  </span>
                )}
              </p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-xs text-muted-foreground">组合总市值</p>
              <p className="text-lg font-semibold">{formatCurrency(p.totalMarketValue)}</p>
              <p className={`text-xs ${pnlColor(p.totalPnl)}`}>
                累计{formatSigned(p.totalPnl)}{formatCurrency(p.totalPnl)}（{formatPercent(p.totalPnlPct)}）
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 模块1：组合盈亏快照 */}
      <SectionCard title="组合盈亏快照" icon={<TrendingUp className="h-4 w-4" />}>
        {p.holdings.length === 0 ? (
          <Empty text="暂无持仓行情" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-1.5 pr-2 font-medium">基金</th>
                  <th className="text-right py-1.5 px-2 font-medium">净值</th>
                  <th className="text-right py-1.5 px-2 font-medium">今日</th>
                  <th className="text-right py-1.5 px-2 font-medium">收益率</th>
                  <th className="text-right py-1.5 px-2 font-medium">市值</th>
                  <th className="text-right py-1.5 px-2 font-medium">今日盈亏</th>
                  <th className="text-right py-1.5 pl-2 font-medium">累计盈亏</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.map((h) => (
                  <tr key={h.code} className="border-b border-muted/50">
                    <td className="py-1.5 pr-2">
                      <div className="font-mono text-[10px] text-muted-foreground">{h.code}</div>
                      <div className="truncate max-w-[120px]">{h.name}</div>
                    </td>
                    <td className="text-right px-2 font-mono">{h.nav.toFixed(4)}</td>
                    <td className={`text-right px-2 ${pnlColor(h.dailyChange)}`}>{formatPercent(h.dailyChange)}</td>
                    {h.pnlKnown ? (
                      <td className={`text-right px-2 ${pnlColor(h.returnRate)}`}>{formatPercent(h.returnRate)}</td>
                    ) : (
                      <td className="text-right px-2 text-muted-foreground">成本未知</td>
                    )}
                    <td className="text-right px-2 font-mono">{formatCurrency(h.marketValue)}</td>
                    <td className={`text-right px-2 ${pnlColor(h.dayPnl)}`}>{formatSigned(h.dayPnl)}{formatCurrency(h.dayPnl)}</td>
                    {h.pnlKnown ? (
                      <td className={`text-right pl-2 ${pnlColor(h.totalPnl)}`}>{formatSigned(h.totalPnl)}{formatCurrency(h.totalPnl)}</td>
                    ) : (
                      <td className="text-right pl-2 text-muted-foreground">成本未知</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* 模块2：行动建议 */}
      <SectionCard title="行动建议（当日触发）" icon={<Sparkles className="h-4 w-4" />}>
        {report.suggestions.length === 0 ? (
          <Empty text="今日无触发提醒。可在「投资计划」点击检查，或配置趋势/涨跌规则。" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <SuggestionGroup title="建议加仓" items={buySuggestions} tone="up" />
            <SuggestionGroup title="建议减仓 / 止盈" items={sellSuggestions} tone="down" />
          </div>
        )}
      </SectionCard>

      {/* 模块3：计划进度 */}
      <SectionCard title="计划进度" icon={<CalendarDays className="h-4 w-4" />}>
        {report.planProgress.length === 0 ? (
          <Empty text="暂无规则。前往「投资计划」添加或导入智能预设。" />
        ) : (
          <div className="space-y-2">
            {report.planProgress.map((item) => (
              <ProgressRow key={item.ruleId} item={item} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* 模块4：板块温度 + 当日信号 */}
      <SectionCard title="板块温度 + 当日信号" icon={<TrendingUp className="h-4 w-4" />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">板块温度（持仓加权）</span>
              {report.market.sectorEnabled ? (
                report.market.avgSectorScore != null ? (
                  <Badge variant="outline" className="text-[10px]">
                    均温 {report.market.avgSectorScore.toFixed(0)}
                  </Badge>
                ) : null
              ) : (
                <Badge variant="outline" className="text-[10px]">未开启东财增强</Badge>
              )}
            </div>
            {!report.market.sectorEnabled ? (
              <p className="text-[11px] text-muted-foreground py-2">
                板块温度依赖东方财富增强（设置 → 数据源增强）。开启后可显示各行业/赛道涨跌温度。
              </p>
            ) : report.market.sectorTemp.length === 0 ? (
              <Empty text="暂未取得板块温度" />
            ) : (
              <div className="space-y-1">
                {report.market.sectorTemp.map((s, i) => (
                  <SectorRow key={i} item={s} />
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">当日技术信号</span>
              {report.market.lowConfidenceCount > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {report.market.lowConfidenceCount} 只基于净值（低置信）
                </Badge>
              )}
            </div>
            {report.market.signals.length === 0 ? (
              <Empty text="当日无技术信号事件（金叉/死叉/SAR 等）" />
            ) : (
              <div className="space-y-1 max-h-64 overflow-auto">
                {report.market.signals.map((s, i) => (
                  <SignalRow key={i} item={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <p className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
        <Info className="h-3 w-3" />
        以上为基于持仓、行情与决策引擎的自动化建议，仅供参考，非交易指令。
      </p>
    </div>
  )
}

// ─── 子组件 ─────────────────────────────────────

function Header({
  onGenerate,
  generating,
  onCopy,
  canCopy,
}: {
  onGenerate: () => void
  generating: boolean
  onCopy: () => void
  canCopy: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">每日日报</h1>
        <p className="text-sm text-muted-foreground mt-1">
          组合盈亏 · 行动建议 · 计划进度 · 板块温度与信号
        </p>
      </div>
      <div className="flex items-center gap-2">
        {canCopy && (
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="h-3 w-3 mr-1" />复制
          </Button>
        )}
        <Button size="sm" onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          重新生成
        </Button>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-primary">{icon}</span>
          {title}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-3 text-center">{text}</p>
}

function SuggestionGroup({
  title,
  items,
  tone,
}: {
  title: string
  items: DailyReport['suggestions']
  tone: 'up' | 'down'
}) {
  return (
    <div className="space-y-1.5">
      <p className={`text-xs font-medium ${tone === 'up' ? 'text-up' : 'text-down'}`}>{title}（{items.length}）</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-1.5">无</p>
      ) : (
        items.map((a) => (
          <div key={a.id} className="rounded-lg border p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{a.fundCode}</span>
              <span className="truncate">{a.fundName}</span>
            </div>
            <p className="text-muted-foreground mt-0.5">{a.reason}</p>
          </div>
        ))
      )}
    </div>
  )
}

function ProgressRow({ item }: { item: PlanProgressItem }) {
  const meta = STATUS_META[item.status]
  const valueSuffix = item.ruleType === 'dca' ? '天' : item.ruleType === 'return' || item.ruleType === 'daily_change' ? '%' : ''
  return (
    <div className="flex items-center justify-between rounded-lg border p-2.5">
      <div className="min-w-0">
        <div className="text-xs font-medium">{RULE_TYPE_LABELS[item.ruleType]}</div>
        <div className="text-[10px] text-muted-foreground">
          {COMPARATOR_LABELS[item.comparator]} {item.threshold}
          {valueSuffix} → {item.action === 'buy' ? '加仓' : '减仓'}
        </div>
        {item.note && <div className="text-[10px] text-muted-foreground/80 mt-0.5">{item.note}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <div className="text-xs font-mono">
            {item.currentValue == null ? '—' : `${item.currentValue.toFixed(1)}${valueSuffix}`}
          </div>
          {item.distance != null && (
            <div className={`text-[10px] ${pnlColor(item.distance)}`}>
              距阈值 {formatSigned(item.distance).trim()}{Math.abs(item.distance).toFixed(1)}
            </div>
          )}
        </div>
        <Badge className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
      </div>
    </div>
  )
}

function SectorRow({ item }: { item: SectorTempItem }) {
  const change = item.changePercent ?? 0
  return (
    <div className="flex items-center justify-between text-xs rounded-md bg-muted/40 px-2 py-1.5">
      <span className="truncate max-w-[140px]">{item.name}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] ${pnlColor(change)}`}>{formatPercent(change)}</span>
        <span className="font-mono text-muted-foreground">温 {item.score?.toFixed(0)}</span>
      </div>
    </div>
  )
}

function SignalRow({ item }: { item: MarketSignalItem }) {
  const Icon = item.direction === 'up' ? ArrowUp : item.direction === 'down' ? ArrowDown : ArrowRight
  const cls = item.direction === 'up' ? 'text-up' : item.direction === 'down' ? 'text-down' : 'text-muted-foreground'
  return (
    <div className="flex items-center justify-between text-xs rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-3 w-3 shrink-0 ${cls}`} />
        <span className="truncate">{item.label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[80px]">{item.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{item.date.slice(5)}</span>
      </div>
    </div>
  )
}

// ─── 分享文本 ─────────────────────────────────────

function buildShareText(r: DailyReport): string {
  const p = r.portfolio
  const lines: string[] = []
  lines.push(`【基金日报 ${r.date}】`)
  lines.push(`今日盈亏：${formatSigned(p.dayPnl)}${p.dayPnl.toFixed(2)} 元（${formatPercent(p.dayPnlPct)}）`)
  lines.push(`组合市值：${p.totalMarketValue.toFixed(2)} 元，累计${formatSigned(p.totalPnl)}${p.totalPnl.toFixed(2)} 元（${formatPercent(p.totalPnlPct)}）`)
  if (r.suggestions.length > 0) {
    lines.push('')
    lines.push('— 行动建议 —')
    for (const a of r.suggestions) {
      lines.push(`[${a.action === 'buy' ? '加仓' : '减仓'}] ${a.fundName}(${a.fundCode})：${a.reason}`)
    }
  }
  if (r.planProgress.length > 0) {
    lines.push('')
    lines.push('— 计划进度 —')
    for (const it of r.planProgress) {
      const cur = it.currentValue == null ? '—' : `${it.currentValue.toFixed(1)}`
      lines.push(`· ${RULE_TYPE_LABELS[it.ruleType]} ${COMPARATOR_LABELS[it.comparator]} ${it.threshold}：当前 ${cur}（${STATUS_META[it.status].label}）${it.note ? ' ' + it.note : ''}`)
    }
  }
  if (r.market.sectorEnabled && r.market.sectorTemp.length > 0) {
    lines.push('')
    lines.push('— 板块温度 —')
    for (const s of r.market.sectorTemp.slice(0, 8)) {
      lines.push(`· ${s.name}：${formatPercent(s.changePercent ?? 0)}（温 ${s.score?.toFixed(0)}）`)
    }
  }
  if (r.market.signals.length > 0) {
    lines.push('')
    lines.push('— 当日信号 —')
    for (const s of r.market.signals.slice(0, 8)) {
      lines.push(`· ${s.label}（${s.name} ${s.date}）`)
    }
  }
  lines.push('')
  lines.push('（自动化建议，仅供参考，非交易指令）')
  return lines.join('\n')
}
