import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { generatePrompt, type PromptTemplateType } from '@/services/prompt'
import { getKlineCache, setKlineCache, deleteKlineCache, getKlineCacheTime, getPortfolioCache, setPortfolioCache, deletePortfolioCache, getPortfolioCacheTime, getQuotesCache, setQuotesCache, formatCacheTime } from '@/services/klineCache'
import type { KLineData } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import CandlestickChart from '@/components/dashboard/CandlestickChart'
import { Loader2, Sparkles, ArrowLeft, Copy, CheckCircle, FileText, Pencil, TrendingUp, BrainCircuit, MessageSquareText, Wallet } from 'lucide-react'
import EditFundDialog from '@/components/holdings/EditFundDialog'
import QuickAdjustDialog from '@/components/holdings/QuickAdjustDialog'
import { detectPatterns, formatPatternsSummary, getPatternLabel } from '@/services/klinePatterns'
import type { DetectedPattern } from '@/services/klinePatterns'
import { analyzeKline } from '@/services/klineAnalysis'
import type { KlineAnalysisResult } from '@/services/klineAnalysis'

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
const MARKET_LABELS: Record<string, string> = { A: 'A股', HK: '港股', US: '美股' }

/** Prompt 模板说明 */
const TEMPLATE_HINTS: Record<string, string> = {
  diagnostic: '根据持仓明细（成本/市值/收益率/涨跌幅）生成投资诊断，分析集中度、风险收益、调仓建议',
  rebalance: '结合持仓明细和投资计划提醒（收益率触发/涨跌幅/K线形态等），给出具体的调仓顺序和仓位调整建议',
  kline_enhanced: '结合持仓明细、ETF 映射和 K 线形态检测结果（算法预检测 + 量价数据），分析技术面趋势与入场时机',
}

export default function FundDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const alerts = usePlansStore((s) => s.alerts)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)

  // 自动选中第一个持仓或 URL 指定的基金
  const fund = useMemo(() => {
    const fromUrl = holdings.find((h) => h.id === id)
    return fromUrl || holdings[0] || null
  }, [holdings, id])

  // 同步 URL 到实际选中的基金
  useEffect(() => {
    if (holdings.length > 0 && fund && fund.id !== id) {
      navigate(`/detail/${fund.id}`, { replace: true })
    }
  }, [holdings, fund, id, navigate])

  // 基金切换
  const handleSwitchFund = (newId: string) => {
    navigate(`/detail/${newId}`)
  }

  // K 线
  const [period, setPeriod] = useState('3m')
  const [klineData, setKlineData] = useState<any[]>([])
  const [klineLoading, setKlineLoading] = useState(false)
  const [klineUpdateTime, setKlineUpdateTime] = useState<string | null>(null)
  const [klineRefreshKey, setKlineRefreshKey] = useState(0)
  const [useEtfKline, setUseEtfKline] = useState(true)
  const [showMA, setShowMA] = useState(true)
  const [showBollinger, setShowBollinger] = useState(false)

  // ETF 映射
  const etfCode = useMemo(() => {
    if (!fund) return null
    const m = etfMappings.find((m) => m.otcCode === fund.code)
    return m?.exchangeCode || null
  }, [fund, etfMappings])

  // Prompt
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [templateType, setTemplateType] = useState<PromptTemplateType>('diagnostic')
  const [quotes, setQuotes] = useState<any[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState({ kline: false, portfolio: false, quotes: false })
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  // 持仓穿透（带缓存）
  const [portfolio, setPortfolio] = useState<{ date: string; holdings: { code: string; name: string; ratio: number; value: number }[] } | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioUpdateTime, setPortfolioUpdateTime] = useState<string | null>(null)

  // K 线分析
  const [klineDetectedPatterns, setKlineDetectedPatterns] = useState<DetectedPattern[]>([])
  const [klinePatterns, setKlinePatterns] = useState<string>('')
  const [klineAnalysis, setKlineAnalysis] = useState<KlineAnalysisResult | null>(null)
  const [klineAnalyzing, setKlineAnalyzing] = useState(false)
  const [klineAnalysisError, setKlineAnalysisError] = useState<string | null>(null)
  // 联动：K 线图悬停索引
  const [hoveredKlineIndex, setHoveredKlineIndex] = useState<number | null>(null)
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  useEffect(() => { loadHoldings() }, [loadHoldings])
  useEffect(() => { loadAlerts() }, [loadAlerts])

  // 加载行情（带缓存）
  const loadQuotes = useCallback(async (force = false) => {
    if (!fund) return
    setQuotesLoading(true)
    if (!force) {
      const cached = await getQuotesCache([fund.code])
      if (cached?.quotes?.length) {
        setQuotes(cached.quotes)
        setQuotesLoading(false)
        return
      }
    }
    try {
      const data = await dataSourceService.fetchQuotes([fund.code])
      setQuotes(data)
      if (data.length > 0) setQuotesCache([fund.code], data)
    } catch (e) {
      console.error('加载行情失败', e)
    }
    setQuotesLoading(false)
  }, [fund])

  useEffect(() => { setTimeout(() => { loadQuotes().catch(() => {}) }, 0) }, [loadQuotes])

  // 手动刷新 K 线
  const handleRefreshKline = useCallback(async () => {
    if (!fund) return
    setRefreshing((s) => ({ ...s, kline: true }))
    await deleteKlineCache(`etf_${etfCode}`, period)
    await deleteKlineCache(fund.code, period)
    setKlineData([])
    setKlineRefreshKey((k) => k + 1)  // 触发 useEffect 重新加载
    setRefreshing((s) => ({ ...s, kline: false }))
  }, [fund, etfCode, period])

  // 手动刷新重仓股
  const handleRefreshPortfolio = useCallback(async () => {
    if (!fund) return
    setRefreshing((s) => ({ ...s, portfolio: true }))
    await deletePortfolioCache(fund.code)
    setPortfolioLoading(true)
    setPortfolio(null)
    setRefreshing((s) => ({ ...s, portfolio: false }))
  }, [fund])

  // K 线（带安全超时）
  useEffect(() => {
    if (!fund) return
    let cancelled = false
    setTimeout(() => setKlineLoading(true), 0)

    // safety timeout: 15s 后强制停止 loading
    const timer = setTimeout(() => {
      if (!cancelled) setKlineLoading(false)
    }, 15000)

    const load = async () => {
      const etfCacheKey = `etf_${etfCode}`
      const navCacheKey = fund.code
      const _cacheKey = useEtfKline ? etfCacheKey : navCacheKey

      // 先查缓存（ETF 和 NAV 都查）
      const [cached, navCached] = await Promise.all([
        getKlineCache(etfCacheKey, period),
        getKlineCache(navCacheKey, period),
      ])
      // 如果当前模式有缓存则直接显示
      if (!cancelled) {
        if (useEtfKline && cached?.length) {
          clearTimeout(timer); setKlineData(cached); setKlineLoading(false)
          getKlineCacheTime(etfCacheKey, period).then((ts) => ts && setKlineUpdateTime(formatCacheTime(ts)))
          return
        }
        if (!useEtfKline && navCached?.length) {
          clearTimeout(timer); setKlineData(navCached); setKlineLoading(false)
          getKlineCacheTime(navCacheKey, period).then((ts) => ts && setKlineUpdateTime(formatCacheTime(ts)))
          return
        }
      }

      // 无缓存，并发拉取 ETF + NAV，全部写入缓存
      const [etfData, navData] = await Promise.all([
        etfCode ? dataSourceService.fetchEtfKLine(etfCode, period) : Promise.resolve([]),
        dataSourceService.fetchKLine(fund.code, period),
      ])
      if (!cancelled) {
        if (etfData.length > 0) setKlineCache(etfCacheKey, period, etfData)
        if (navData.length > 0) setKlineCache(navCacheKey, period, navData)
        clearTimeout(timer)
        setKlineData(useEtfKline && etfData.length > 0 ? etfData : navData)
        setKlineLoading(false)
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [fund, period, etfCode, useEtfKline, klineRefreshKey])

  // K 线加载完成后运行算法检测
  useEffect(() => {
    if (klineData.length === 0) return
    const patterns = detectPatterns(klineData)
    setKlineDetectedPatterns(patterns)
    setKlinePatterns(formatPatternsSummary(patterns, klineData))
    setKlineAnalysis(null)
    setKlineAnalysisError(null)
  }, [klineData])

  // AI 分析 K 线
  const handleAnalyzeKline = useCallback(async () => {
    if (!fund || klineData.length === 0) return
    setKlineAnalyzing(true)
    setKlineAnalysisError(null)
    try {
      const { result, usedAI, error } = await analyzeKline({
        code: fund.code,
        name: fund.name || fund.code,
        klineData,
        period,
        costNAV: fund.costNAV,
        currentNAV: quotes.find((q) => q.code === fund.code)?.nav,
        shares: fund.shares,
      })
      setKlineAnalysis(result)
      if (!usedAI && error) setKlineAnalysisError(error)
    } catch (e) {
      setKlineAnalysisError(e instanceof Error ? e.message : '分析失败')
    }
    setKlineAnalyzing(false)
  }, [fund, klineData, period, quotes])

  useEffect(() => {
    if (!fund) return
    let cancelled = false
    setTimeout(() => setPortfolioLoading(true), 0)

    const load = async () => {
      // 尝试缓存
      const cached = await getPortfolioCache(fund.code)
      if (!cancelled && cached) {
        setPortfolio(cached); setPortfolioLoading(false)
        getPortfolioCacheTime(fund.code).then((ts) => ts && setPortfolioUpdateTime(formatCacheTime(ts)))
        return
      }

      // 调用 API
      const data = await dataSourceService.fetchFundPortfolio(fund.code)
      if (!cancelled && data) {
        setPortfolioCache(fund.code, data)
        setPortfolio(data)
      }
      if (!cancelled) setPortfolioLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [fund])

  const handleGenerate = useCallback(() => {
    if (!fund) return
    const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund.code)
    const klineDataMap: Record<string, KLineData[]> = {}
    for (const m of etfMappingsForFund) {
      if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData
    }
    const result = generatePrompt({
      templateType,
      holdings: [fund],
      quotes,
      selectedIds: [fund.id],
      etfMappings,
      alerts,
      klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
    })
    setPrompt(result)
    setCopied(false)
  }, [fund, templateType, quotes, etfMappings, alerts, klineData])

  /** 生成 K 线增强 Prompt 并跳转到预览 */
  const handleGenerateKlinePrompt = useCallback(() => {
    setTemplateType('kline_enhanced')
    // 下一轮渲染时 templateType 才生效，微任务触发重生成
    setTimeout(() => {
      const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund?.code)
      const klineDataMap: Record<string, KLineData[]> = {}
      for (const m of etfMappingsForFund) {
        if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData
      }
      const result = generatePrompt({
        templateType: 'kline_enhanced',
        holdings: fund ? [fund] : [],
        quotes,
        selectedIds: fund ? [fund.id] : [],
        etfMappings,
        alerts,
        klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
      })
      setPrompt(result)
      setCopied(false)
    }, 0)
  }, [fund, quotes, etfMappings, alerts, klineData])

  const handleCopy = useCallback(async () => {
    if (!prompt) return
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch {
      const ta = document.createElement('textarea'); ta.value = prompt
      document.body.appendChild(ta); ta.select(); document.execCommand('copy')
      document.body.removeChild(ta); setCopied(true); setTimeout(() => setCopied(false), 2000)
    }
  }, [prompt])

  if (!fund) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/holdings')}><ArrowLeft className="h-3 w-3 mr-1" />返回持仓</Button>
        <Card><CardContent className="text-center py-16"><p className="text-muted-foreground">基金不存在</p></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 返回 + 基金切换 + 基本信息 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Select value={fund.id} onValueChange={handleSwitchFund}>
              <SelectTrigger className="w-[280px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {holdings.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="font-mono text-[10px] mr-2">{h.code}</span>
                    {h.name || h.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Badge variant="secondary" className="text-[10px]">{MARKET_LABELS[fund.market] || fund.market}</Badge>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[fund.type] || fund.type}</Badge>
              <Badge variant="outline" className="text-[10px]">{SECTOR_LABELS[fund.sector] || fund.sector}</Badge>
              {etfCode && <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">ETF {etfCode}</Badge>}
            </div>
          </div>
          <h1 className="text-xl font-bold tracking-tight mt-1">{fund.name || fund.code}</h1>
        </div>
      </div>

      {/* 持仓信息 + 调仓/编辑 */}
      {fund && (() => {
        const q = quotes.find((q) => q.code === fund.code)
        const currentNAV = q?.nav
        const costValue1 = fund.costNAV && fund.shares ? fund.costNAV * fund.shares : 0
        const costValue2 = fund.holdingAmount != null && fund.holdingProfit != null
          ? fund.holdingAmount - fund.holdingProfit
          : 0
        const investment = costValue1 || costValue2 || 0
        const currentValue = fund.holdingAmount || (fund.costNAV && fund.shares ? fund.costNAV * fund.shares : 0)
        const profit = currentValue - investment
        const returnRate = investment > 0 ? (profit / investment) * 100 : 0
        const isProfit = profit >= 0

        return (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" />持仓信息
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAdjustOpen(true)}>
                    <TrendingUp className="h-3 w-3 mr-1 text-green-500" />调仓
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-3 w-3 mr-1" />编辑
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">持有份额</p>
                  <p className="text-sm font-medium">{fund.shares?.toLocaleString() || '-'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">持仓成本</p>
                  <p className="text-sm font-medium">¥{fund.costNAV?.toFixed(4) || '-'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">
                    最新净值
                    {q?.navDate && <span className="ml-1">({q.navDate.slice(5)})</span>}
                  </p>
                  <p className="text-sm font-medium">
                    {currentNAV ? `¥${currentNAV.toFixed(4)}` : '-'}
                    {q?.dailyChange != null && (
                      <span className={`ml-1 text-[10px] ${q.dailyChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {q.dailyChange >= 0 ? '+' : ''}{q.dailyChange.toFixed(2)}%
                      </span>
                    )}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">投入本金</p>
                  <p className="text-sm font-medium">{investment ? `¥${investment.toFixed(2)}` : '-'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">当前市值</p>
                  <p className="text-sm font-medium">{currentValue ? `¥${currentValue.toFixed(2)}` : '-'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">浮动盈亏</p>
                  <p className={`text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    {profit ? `${isProfit ? '+' : ''}¥${profit.toFixed(2)}` : '-'}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">收益率</p>
                  <p className={`text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                    {investment > 0 ? `${isProfit ? '+' : ''}${returnRate.toFixed(2)}%` : '-'}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">购买日期</p>
                  <p className="text-sm font-medium">{fund.purchaseDate || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      <EditFundDialog fund={fund} open={editOpen} onOpenChange={setEditOpen} />
      <QuickAdjustDialog fund={fund} open={adjustOpen} onOpenChange={setAdjustOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: K 线图 */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">K 线走势</CardTitle>
                  {klineUpdateTime && <span className="text-[10px] text-muted-foreground">更新于 {klineUpdateTime}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleRefreshKline} disabled={refreshing.kline} className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50">{refreshing.kline ? '⟳' : '⟳ 刷新'}</button>
                  <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="h-7 text-xs w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1月</SelectItem>
                    <SelectItem value="3m">3月</SelectItem>
                    <SelectItem value="6m">6月</SelectItem>
                    <SelectItem value="1y">1年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* 技术指标切换 */}
              {useEtfKline && etfCode && klineData[0]?.volume && (
                <div className="flex items-center gap-1 mt-2">
                  <button
                    onClick={() => setShowMA(!showMA)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      showMA ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-400' : 'border-transparent text-muted-foreground hover:bg-muted/50'
                    }`}
                  >MA</button>
                  <button
                    onClick={() => setShowBollinger(!showBollinger)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                      showBollinger ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-400' : 'border-transparent text-muted-foreground hover:bg-muted/50'
                    }`}
                  >BOLL</button>
                </div>
              )}
            </div>
            </CardHeader>
            <CardContent>
              {etfCode && (
                <div className="flex items-center gap-2 mb-3">
                  <Switch id="etf-kline" checked={useEtfKline} onCheckedChange={setUseEtfKline} />
                  <Label htmlFor="etf-kline" className="text-xs cursor-pointer">
                    场内 ETF 真实 K 线 <span className="text-[10px] text-muted-foreground">（{etfCode}）</span>
                  </Label>
                </div>
              )}
              {klineLoading ? (
                <div className="flex items-center justify-center h-[200px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : useEtfKline && etfCode && klineData[0]?.volume ? (
                <CandlestickChart data={klineData} width={560} height={320} patterns={klineDetectedPatterns} onHover={setHoveredKlineIndex} showMA={showMA} showBollinger={showBollinger} />
              ) : (
                <div className="flex items-center justify-center h-[200px]">
                  {klineData.length > 0 ? (
                    <svg width={560} height={200} className="overflow-visible">
                      {/* Simplified mini line chart for NAV */}
                      <polyline
                        points={klineData.map((d, i) => `${i * (560 / Math.max(klineData.length - 1, 1))},${180 - ((d.close - Math.min(...klineData.map((x) => x.close))) / (Math.max(...klineData.map((x) => x.close)) - Math.min(...klineData.map((x) => x.close)) || 1)) * 160}`).join(' ')}
                        fill="none" stroke="#3b82f6" strokeWidth={2}
                      />
                    </svg>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无数据</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* K 线形态分析 */}
          {klineData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <BrainCircuit className="h-3.5 w-3.5" />K 线形态分析
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={klineData.length === 0}
                      onClick={handleGenerateKlinePrompt}
                    >
                      <MessageSquareText className="h-3 w-3 mr-1" />生成 Prompt
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={klineAnalyzing || klineData.length === 0}
                      onClick={handleAnalyzeKline}
                    >
                      {klineAnalyzing ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />分析中</>
                      ) : (
                        <><Sparkles className="h-3 w-3 mr-1" />AI 分析</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 算法检测结果（始终显示） */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">算法检测</p>
                  {klineDetectedPatterns.length > 0 ? (
                    <div className="space-y-0.5">
                      {/* 按索引倒序排列，最新的 K 线展示在最上方 */}
                      {[...klineDetectedPatterns]
                        .sort((a, b) => b.index - a.index)
                        .map((p, i) => {
                          const isHovered = hoveredKlineIndex === p.index
                          return (
                            <div
                              key={`${p.type}-${p.index}-${i}`}
                              className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors ${
                                isHovered
                                  ? 'bg-primary/10 ring-1 ring-primary/30'
                                  : 'hover:bg-muted/40'
                              }`}
                            >
                              {/* 形态名称标签 */}
                              <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                                p.direction === 'bullish'
                                  ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                                  : p.direction === 'bearish'
                                    ? 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400'
                                    : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                              }`}>
                                {getPatternLabel([p], p.index) || p.type}
                              </span>
                              {/* 日期 */}
                              <span className="text-muted-foreground text-[10px] shrink-0">
                                {klineData[p.index]?.date || ''}
                              </span>
                              {/* 描述 */}
                              <span className="text-muted-foreground truncate flex-1 min-w-0">
                                {p.description}
                              </span>
                              {/* 类型 + 置信度 */}
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {p.isMultiCandle ? `${p.candleCount}K` : '单K'} · {(p.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  ) : (
                    <div className="text-xs leading-relaxed whitespace-pre-line font-mono bg-muted/30 rounded p-2">
                      {klinePatterns || '计算中...'}
                    </div>
                  )}
                </div>

                {/* AI 分析结果 */}
                {klineAnalysis && (
                  <div className="space-y-2 border-t pt-2">
                    <p className="text-[10px] text-muted-foreground">AI 深度分析</p>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">趋势：</span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        klineAnalysis.trend === 'bullish'
                          ? 'bg-red-50 text-red-600'
                          : klineAnalysis.trend === 'bearish'
                            ? 'bg-green-50 text-green-600'
                            : 'bg-gray-50 text-gray-600'
                      }`}>
                        {klineAnalysis.trend === 'bullish' ? '多头 ↑' : klineAnalysis.trend === 'bearish' ? '空头 ↓' : '震荡 ↔'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        置信度: {klineAnalysis.confidence === 'high' ? '高' : klineAnalysis.confidence === 'medium' ? '中' : '低'}
                      </span>
                    </div>

                    {klineAnalysis.support !== undefined && klineAnalysis.resistance !== undefined && (
                      <div className="flex gap-3 text-xs">
                        <span className="text-red-500">支撑: ¥{klineAnalysis.support.toFixed(4)}</span>
                        <span className="text-green-500">阻力: ¥{klineAnalysis.resistance.toFixed(4)}</span>
                      </div>
                    )}

                    <div className="text-xs p-2 rounded bg-muted/30 leading-relaxed">
                      {klineAnalysis.advice}
                    </div>

                    {klineAnalysisError && (
                      <p className="text-[10px] text-orange-500">注: {klineAnalysisError}，仅显示算法检测结果</p>
                    )}
                  </div>
                )}

                {/* 术语说明 */}
                <div className="border-t pt-2">
                  <button
                    onClick={() => setGlossaryOpen(!glossaryOpen)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <span className={`inline-block transition-transform ${glossaryOpen ? 'rotate-90' : ''}`}>▶</span>
                    K 线形态术语说明
                  </button>
                  {glossaryOpen && (
                    <div className="mt-2 text-[10px] text-muted-foreground leading-relaxed space-y-2">
                      <div className="p-2 rounded bg-muted/20">
                        <p className="font-medium text-foreground mb-0.5">📌 单 K 形态</p>
                        <p>基于单根 K 线的形状判断价格行为。常见形态包括十字星（多空平衡）、锤子线（下方支撑）、光头光脚（单边行情）等。</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {['十字星','T字线','长十字星','锤子线','射击之星','光头阳/阴线','上/下影线','小阳/阴线'].map((t) => (
                            <span key={t} className="px-1 py-0.5 rounded bg-muted/40 text-[9px]">{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/20">
                        <p className="font-medium text-foreground mb-0.5">📌 2K 组合</p>
                        <p>两根连续 K 线组成的形态，通过前后对比判断趋势反转：</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium">看涨吞没</span>
                          <span className="text-[9px] text-muted-foreground self-center">后阳线实体完全覆盖前阴线，强势反转看涨</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium">看跌吞没</span>
                          <span className="text-[9px] text-muted-foreground self-center">后阴线实体完全覆盖前阳线，强势反转看跌</span>
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/20">
                        <p className="font-medium text-foreground mb-0.5">📌 3K 组合</p>
                        <p>三根连续 K 线组成的形态，反转信号更强：</p>
                        <div className="mt-1 flex flex-wrap gap-1 items-start">
                          <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium shrink-0">晨星</span>
                          <span className="text-[9px] text-muted-foreground">大阴 → 小实体(星) → 大阳，底部反转</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1 items-start">
                          <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium shrink-0">暮星</span>
                          <span className="text-[9px] text-muted-foreground">大阳 → 小实体(星) → 大阴，顶部反转</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1 items-start">
                          <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium shrink-0">三连阳</span>
                          <span className="text-[9px] text-muted-foreground">连续三根阳线实体递增，多头稳步推进</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1 items-start">
                          <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium shrink-0">三连阴</span>
                          <span className="text-[9px] text-muted-foreground">连续三根阴线实体递增，空头稳步推进</span>
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/20">
                        <p className="font-medium text-foreground mb-0.5">📌 其他术语</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
                          <span><span className="text-red-500 font-medium">红色</span>=涨 (阳线)</span>
                          <span><span className="text-green-500 font-medium">绿色</span>=跌 (阴线)</span>
                          <span>实体 = 开收盘价差</span>
                          <span>上/下影线 = 最高/低价与实体的差距</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Prompt */}
        <div className="space-y-4">
          {/* 持仓穿透 */}
          {portfolio?.holdings && portfolio.holdings.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">重仓股</CardTitle>
                  {portfolioUpdateTime && <span className="text-[10px] text-muted-foreground">更新于 {portfolioUpdateTime}</span>}
                </div>
                <button onClick={handleRefreshPortfolio} disabled={refreshing.portfolio} className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50">{refreshing.portfolio ? '⟳' : '⟳ 刷新'}</button>
              </div>
            </CardHeader>
            <CardContent>
              {portfolioLoading ? (
                <div className="flex items-center justify-center h-16"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">报告期：{portfolio.date}</p>
                  <div className="space-y-1">
                    {portfolio.holdings.map((h, i) => (
                      <div key={h.code} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/30">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[10px] text-muted-foreground w-4 text-right">{i + 1}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{h.code}</span>
                          <span className="truncate">{h.name}</span>
                        </div>
                        <span className={`font-mono font-medium shrink-0 ${h.ratio >= 5 ? 'text-red-500' : ''}`}>
                          {h.ratio.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Prompt 模板</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                {(['diagnostic', 'rebalance', 'kline_enhanced'] as const).map((t) => (
                  <button key={t}
                    onClick={() => setTemplateType(t)}
                    title={TEMPLATE_HINTS[t]}
                    className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                      templateType === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
                    }`}
                  >
                    {t === 'diagnostic' ? '诊断' : t === 'rebalance' ? '调仓' : 'K线'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {TEMPLATE_HINTS[templateType]}
              </p>
              <Button size="sm" className="w-full" disabled={quotesLoading} onClick={handleGenerate}>
                <Sparkles className="h-3 w-3 mr-1" />生成分析 Prompt
              </Button>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Prompt 预览</CardTitle>
                <Button variant="outline" size="sm" className="h-6 text-xs" disabled={!prompt} onClick={handleCopy}>
                  {copied ? <><CheckCircle className="h-3 w-3 mr-1 text-green-500" />已复制</> : <><Copy className="h-3 w-3 mr-1" />复制</>}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {prompt ? (
                <Textarea value={prompt} readOnly className="min-h-[200px] text-xs font-mono leading-relaxed" />
              ) : (
                <div className="text-center py-8 text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-xs">点击「生成」创建分析 Prompt</p></div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
