import { useEffect, useState, useMemo, useCallback } from 'react'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, Wallet, BarChart3, PieChartIcon,
  DollarSign, Percent, Loader2, AlertCircle,
} from 'lucide-react'
import type { FundQuote, FundHolding } from '@/types'
import { getKlineCache, setKlineCache, deleteKlineCache, getQuotesCache, setQuotesCache, deleteQuotesCache, getQuotesCacheTime, formatCacheTime } from '@/services/klineCache'
import RealtimePanel from './RealtimePanel'

const TYPE_COLORS: Record<string, string> = {
  stock: '#ef4444', mixed: '#f97316', bond: '#22c55e', index: '#3b82f6',
  qdii: '#a855f7', money: '#06b6d4', etf: '#eab308', other: '#6b7280',
}
const TYPE_LABELS: Record<string, string> = {
  stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型',
  qdii: 'QDII', money: '货币型', etf: 'ETF', other: '其他',
}
const SECTOR_LABELS: Record<string, string> = {
  tech: '科技', consumer: '消费', healthcare: '医药', new_energy: '新能源',
  finance: '金融', manufacturing: '制造', broad_market: '宽基',
  global: '全球', bond_market: '债市', commodity: '大宗商品',
  real_estate: '地产', other: '其他',
}
const SECTOR_COLORS = ['#3b82f6','#ef4444','#22c55e','#f97316','#a855f7','#06b6d4','#eab308','#ec4899','#8b5cf6','#10b981','#f43f5e','#6b7280']

function calcValue(h: FundHolding): number {
  if (h.costNAV && h.shares) return h.costNAV * h.shares
  if (h.holdingAmount) return h.holdingAmount  // 持有金额已包含收益
  return 0
}

function calcCost(h: FundHolding): number {
  if (h.costNAV && h.shares) return h.costNAV * h.shares
  // 方式二：成本投入 = 持有金额 - 持有收益
  if (h.holdingAmount && h.holdingProfit !== undefined) return h.holdingAmount - h.holdingProfit
  return 0
}

export default function DashboardPage() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loading = useHoldingsStore((s) => s.loading)
  const tushareToken = useSettingsStore((s) => s.settings.dataSource.tushareToken)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const alerts = usePlansStore((s) => s.alerts)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)
  const markAlertExecuted = usePlansStore((s) => s.markAlertExecuted)
  const dismissAlert = usePlansStore((s) => s.dismissAlert)

  const [quotes, setQuotes] = useState<FundQuote[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [_quotesError, setQuotesError] = useState('')
  const [quotesRefreshing, setQuotesRefreshing] = useState(false)
  const [_klineRefreshing, setKlineRefreshing] = useState(false)
  const [selectedFund, _setSelectedFund] = useState<FundHolding | null>(null)
  const [selectedPeriod, _setSelectedPeriod] = useState('3m')
  const [_klineData, setKlineData] = useState<any[]>([])
  const [_klineLoading, setKlineLoading] = useState(false)
  const [useEtfKline, _setUseEtfKline] = useState(true)
  const [quotesUpdateTime, setQuotesUpdateTime] = useState<string | null>(null)
  const [klineRefreshKey, setKlineRefreshKey] = useState(0)

  // 当前选中基金的场内 ETF 映射代码
  const etfCode = useMemo(() => {
    if (!selectedFund) return null
    const m = etfMappings.find((m) => m.otcCode === selectedFund.code)
    return m?.exchangeCode || null
  }, [selectedFund, etfMappings])

  useEffect(() => { loadHoldings() }, [loadHoldings])
  useEffect(() => { loadAlerts() }, [loadAlerts])

  /** 尝试读取行情更新时间 */
  const updateQuotesTime = useCallback(async () => {
    if (holdings.length === 0) return
    const codes = holdings.map((h) => h.code)
    const ts = await getQuotesCacheTime(codes)
    setQuotesUpdateTime(ts ? formatCacheTime(ts) : null)
  }, [holdings])

  // 初始加载时也获取更新时间
  useEffect(() => { if (!quotesUpdateTime) { setTimeout(() => { updateQuotesTime().catch(() => {}) }, 0) } }, [updateQuotesTime, quotesUpdateTime])

  // Load quotes（带缓存 + 手动刷新）
  const loadQuotes = useCallback(async (force = false) => {
    if (holdings.length === 0) return
    const codes = holdings.map((h) => h.code)
    setQuotesLoading(true); setQuotesError('')

    if (!force) {
      const cached = await getQuotesCache(codes)
      if (cached?.quotes?.length) {
        setQuotes(cached.quotes as FundQuote[])
        setQuotesLoading(false)
        return
      }
    }

    try {
      const data = await dataSourceService.fetchQuotes(codes)
      setQuotes(data)
      if (data.length > 0) setQuotesCache(codes, data)
    } catch (e) {
      setQuotesError(String(e))
    }
    setQuotesLoading(false)
  }, [holdings])

  useEffect(() => { setTimeout(() => { loadQuotes().catch(() => {}) }, 0) }, [loadQuotes])

  // Load K-line for selected fund — 优先使用缓存 + 场内 ETF 真实 K 线（带安全超时）
  useEffect(() => {
    if (!selectedFund) return
    let cancelled = false
    setTimeout(() => setKlineLoading(true), 0)

    const timer = setTimeout(() => { if (!cancelled) setKlineLoading(false) }, 15000)

    const loadKline = async () => {
      const etfCacheKey = `etf_${etfCode}`
      const navCacheKey = selectedFund.code
      const _cacheKey = useEtfKline ? etfCacheKey : navCacheKey

      const [cached, navCached] = await Promise.all([
        getKlineCache(etfCacheKey, selectedPeriod),
        getKlineCache(navCacheKey, selectedPeriod),
      ])
      if (!cancelled) {
        if (useEtfKline && cached?.length) { clearTimeout(timer); setKlineData(cached); setKlineLoading(false); return }
        if (!useEtfKline && navCached?.length) { clearTimeout(timer); setKlineData(navCached); setKlineLoading(false); return }
      }

      const [etfData, navData] = await Promise.all([
        etfCode ? dataSourceService.fetchEtfKLine(etfCode, selectedPeriod) : Promise.resolve([]),
        dataSourceService.fetchKLine(selectedFund.code, selectedPeriod),
      ])
      if (!cancelled) {
        if (etfData.length > 0) setKlineCache(etfCacheKey, selectedPeriod, etfData)
        if (navData.length > 0) setKlineCache(navCacheKey, selectedPeriod, navData)
        clearTimeout(timer)
        setKlineData(useEtfKline && etfData.length > 0 ? etfData : navData)
        setKlineLoading(false)
      }
    }
    loadKline()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [selectedFund, selectedPeriod, etfCode, useEtfKline, klineRefreshKey])

  // 手动刷新行情
  const handleRefreshQuotes = async () => {
    setQuotesRefreshing(true)
    await deleteQuotesCache()
    await loadQuotes(true)
    setQuotesUpdateTime(null)
    await updateQuotesTime()
    setQuotesRefreshing(false)
  }

  // 手动刷新 K 线
  const _handleRefreshKline = async () => {
    if (!selectedFund) return
    setKlineRefreshing(true)
    const etfCacheKey = `etf_${etfCode}`
    const navCacheKey = selectedFund.code
    await Promise.all([
      deleteKlineCache(etfCacheKey, selectedPeriod),
      deleteKlineCache(navCacheKey, selectedPeriod),
    ])
    setKlineData([])
    setKlineRefreshKey((k) => k + 1)  // 触发 useEffect 重新运行
    setKlineRefreshing(false)
  }

  // Calc summary
  const summary = useMemo(() => {
    const totalValue = holdings.reduce((s, h) => s + calcValue(h), 0)
    const totalCost = holdings.reduce((s, h) => s + calcCost(h), 0)
    const totalProfit = totalValue - totalCost
    const avgReturn = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0
    // C2 fix: 确保 totalValue > 0 才计算，正确换算为百分比
    const todayChange = totalValue > 0 && quotes.length > 0
      ? holdings.reduce((s, h) => {
          const q = quotes.find((q) => q.code === h.code)
          return s + (q ? calcValue(h) * q.dailyChange / 100 : 0)
        }, 0) / totalValue * 100
      : 0
    return { totalValue, totalCost, totalProfit, avgReturn, todayChange }
  }, [holdings, quotes])

  // Distribution data
  const typeDistribution = useMemo(() => {
    const map = new Map<string, number>()
    for (const h of holdings) {
      map.set(h.type, (map.get(h.type) || 0) + calcValue(h))
    }
    return Array.from(map.entries()).map(([type, value]) => ({
      name: TYPE_LABELS[type] || type, value, type,
    }))
  }, [holdings])

  const sectorDistribution = useMemo(() => {
    const map = new Map<string, number>()
    for (const h of holdings) {
      map.set(h.sector, (map.get(h.sector) || 0) + calcValue(h))
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector, value]) => ({
        name: SECTOR_LABELS[sector] || sector, value,
      }))
  }, [holdings])

  const topHoldings = useMemo(() => {
    return holdings
      .map((h) => ({ name: h.name || h.code, value: calcValue(h), code: h.code }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [holdings])

  const formatCurrency = (v: number) => `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const dataSourceLabel = tushareToken ? 'Tushare' : '模拟数据'

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  if (holdings.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据看板</h1>
          <p className="text-sm text-muted-foreground mt-1">持仓总览与数据分析</p>
        </div>
        <Card>
          <CardContent className="text-center py-20 space-y-3">
            <Wallet className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground">暂无持仓数据，请先在「持仓管理」中添加基金</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据看板</h1>
          <div className="text-sm text-muted-foreground mt-1">
            持仓总览 · 共 {holdings.length} 只基金
            <Badge variant="outline" className="ml-2 text-[10px]">{dataSourceLabel}</Badge>
            {quotesLoading && <Loader2 className="h-3 w-3 inline ml-1 animate-spin" />}
            {quotesUpdateTime && <span className="text-[10px] text-muted-foreground ml-2">数据更新于 {quotesUpdateTime}</span>}
          </div>
        </div>
        <button
          onClick={handleRefreshQuotes}
          disabled={quotesRefreshing}
          className="text-xs px-2 py-1 rounded border hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          {quotesRefreshing ? (
            <><Loader2 className="h-3 w-3 inline mr-1 animate-spin" />刷新中</>
          ) : (
            <>⟳ 刷新数据</>
          )}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <DollarSign className="h-3 w-3" />持仓市值
            </div>
            <p className="text-xl font-bold tracking-tight">{formatCurrency(summary.totalValue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />持仓盈亏
            </div>
            <p className={`text-xl font-bold tracking-tight ${summary.totalProfit >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {summary.totalProfit >= 0 ? '+' : '-'}{formatCurrency(summary.totalProfit)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Percent className="h-3 w-3" />持仓收益率
            </div>
            <p className={`text-xl font-bold tracking-tight ${summary.avgReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {formatPercent(summary.avgReturn)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="h-3 w-3" />今日涨跌
            </div>
            <p className={`text-xl font-bold tracking-tight ${summary.todayChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {formatPercent(summary.todayChange)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <PieChartIcon className="h-3 w-3" />持仓基金
            </div>
            <p className="text-xl font-bold tracking-tight">{holdings.length}</p>
            <p className="text-[10px] text-muted-foreground">只</p>
          </CardContent>
        </Card>
      </div>

      {/* 实时持仓概览 */}
      {holdings.length > 0 && <RealtimePanel holdings={holdings} />}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Type Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">持仓类型分布</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={typeDistribution}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={90}
                  paddingAngle={2} dataKey="value"
                >
                  {typeDistribution.map((entry, i) => (
                    <Cell key={i} fill={TYPE_COLORS[entry.type] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(Number(v) || 0)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Sector Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">投资领域分布</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={sectorDistribution} layout="vertical" margin={{ left: 50, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v: any) => formatCurrency(Number(v) || 0)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {sectorDistribution.map((_, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* NAV Trend + Top Holdings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* NAV Trend → 快捷跳转到详情页 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">基金详情</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {holdings.slice(0, 5).map((h) => (
                <div key={h.id}
                  onClick={() => window.location.href = `/detail/${h.id}`}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{h.code}</span>
                    <span className="text-xs truncate">{h.name || h.code}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">查看详情 →</span>
                </div>
              ))}
              {holdings.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">暂无持仓</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Holdings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">持仓 TOP 10</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topHoldings.map((h, i) => (
                <div key={h.code} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                    <span className="truncate">{h.name}</span>
                  </div>
                  <span className="font-mono font-medium shrink-0">{formatCurrency(h.value)}</span>
                </div>
              ))}
              {topHoldings.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">无数据</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending alerts section */}
      {alerts.filter((a) => !a.executed && !a.dismissed).length > 0 && (
        <Card className="border-l-4 border-l-orange-400">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">投资计划提醒</CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {alerts.filter((a) => !a.executed && !a.dismissed).length} 条待处理
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.filter((a) => !a.executed && !a.dismissed).slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50 text-xs">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="font-mono shrink-0">{alert.fundCode}</span>
                    <span className="truncate max-w-[120px]">{alert.fundName}</span>
                    <Badge variant={alert.action === 'buy' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                      {alert.action === 'buy' ? '买入' : '卖出'}
                    </Badge>
                    <span className="text-muted-foreground truncate">{alert.reason}</span>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button className="text-green-600 hover:text-green-700 text-[10px]" onClick={() => markAlertExecuted(alert.id)}>执行</button>
                    <button className="text-muted-foreground hover:text-foreground text-[10px]" onClick={() => dismissAlert(alert.id)}>忽略</button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
