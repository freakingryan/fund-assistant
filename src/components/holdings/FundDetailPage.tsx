import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { useSettingsStore } from '@/stores/settings'
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes'
import { dataSourceService } from '@/adapters/datasource/service'
import { generatePrompt, type PromptTemplateType } from '@/services/prompt'
import { getKlineCache, setKlineCache, deleteKlineCache, getKlineCacheTime, getPortfolioCache, setPortfolioCache, deletePortfolioCache, deleteQuotesCache, formatCacheTime } from '@/services/klineCache'
import type { KLineData } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import SearchableSelect from '@/components/ui/searchable-select'
import { Loader2, Sparkles, ArrowLeft, Copy, CheckCircle, FileText, Pencil, TrendingUp, Wallet, ChevronRight } from 'lucide-react'
import { RefreshButton } from '@/components/ui/refresh-button'
import EditFundDialog from '@/components/holdings/EditFundDialog'
import QuickAdjustDialog from '@/components/holdings/QuickAdjustDialog'
import KlineChartCard from '@/components/holdings/KlineChartCard'
import KlinePatternCard from '@/components/holdings/KlinePatternCard'
import SignalScoreCard from '@/components/holdings/SignalScoreCard'
import { detectPatterns, formatPatternsSummary } from '@/services/klinePatterns'
import { pnlColor, formatSigned } from '@/lib/format'
import { TYPE_LABELS, SECTOR_LABELS, MARKET_LABELS } from '@/lib/labels'
import type { DetectedPattern } from '@/services/klinePatterns'
import { analyzeKline } from '@/services/klineAnalysis'
import type { KlineAnalysisResult } from '@/services/klineAnalysis'
import { evaluateSignal } from '@/services/signalEngine'
import type { SignalResult } from '@/services/signalEngine'

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

  // ─── 基础数据 ─────────────────────────────────
  const fund = useMemo(() => {
    const fromUrl = holdings.find((h) => h.id === id)
    return fromUrl || holdings[0] || null
  }, [holdings, id])

  useEffect(() => {
    if (holdings.length > 0 && fund && fund.id !== id) {
      navigate(`/detail/${fund.id}`, { replace: true })
    }
  }, [holdings, fund, id, navigate])

  const handleSwitchFund = (newId: string) => navigate(`/detail/${newId}`)

  // ─── 状态 ─────────────────────────────────────
  const [period, setPeriod] = useState('3m')
  const [klineData, setKlineData] = useState<any[]>([])
  const [klineLoading, setKlineLoading] = useState(false)
  const [klineUpdateTime, setKlineUpdateTime] = useState<string | null>(null)
  const [klineRefreshKey, setKlineRefreshKey] = useState(0)
  const [useEtfKline, setUseEtfKline] = useState(true)
  const [showMA, setShowMA] = useState(true)
  const [showBollinger, setShowBollinger] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [templateType, setTemplateType] = useState<PromptTemplateType>('diagnostic')
  const [refreshing, setRefreshing] = useState({ kline: false, portfolio: false, quotes: false })
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [portfolio, setPortfolio] = useState<{ date: string; holdings: { code: string; name: string; ratio: number; value: number }[] } | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0)
  const [klineDetectedPatterns, setKlineDetectedPatterns] = useState<DetectedPattern[]>([])
  const [klinePatterns, setKlinePatterns] = useState<string>('')
  const [klineAnalysis, setKlineAnalysis] = useState<KlineAnalysisResult | null>(null)
  const [klineAnalyzing, setKlineAnalyzing] = useState(false)
  const [klineAnalysisError, setKlineAnalysisError] = useState<string | null>(null)
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null)
  const [showSignalDetail, setShowSignalDetail] = useState(false)
  const [hoveredKlineIndex, setHoveredKlineIndex] = useState<number | null>(null)
  const [selectedKlineIndex, setSelectedKlineIndex] = useState<number | null>(null)

  // 有效高亮：点击选中优先于悬停
  const effectiveKlineHighlight = useMemo(() => selectedKlineIndex ?? hoveredKlineIndex, [selectedKlineIndex, hoveredKlineIndex])

  // K 线形态点击：切换持久化选中
  const handlePatternClick = useCallback((index: number | null) => {
    setSelectedKlineIndex((prev) => prev === index ? null : index)
  }, [])

  // ─── 点击页面其他位置清除选中高亮 ────────────
  useEffect(() => {
    if (selectedKlineIndex === null) return
    const handler = () => setSelectedKlineIndex(null)
    const timer = setTimeout(() => document.addEventListener('click', handler, { once: true }), 100)
    return () => { clearTimeout(timer); document.removeEventListener('click', handler) }
  }, [selectedKlineIndex])

  const etfCode = useMemo(() => {
    if (!fund) return null
    const m = etfMappings.find((m) => m.otcCode === fund.code)
    return m?.exchangeCode || null
  }, [fund, etfMappings])

  useEffect(() => { loadHoldings() }, [loadHoldings])
  useEffect(() => { loadAlerts() }, [loadAlerts])

  // 实时行情：同时获取场外基金 + 场内 ETF 映射
  const quoteCodes = useMemo(() => (fund ? [fund.code, ...(etfCode ? [etfCode] : [])] : []), [fund, etfCode])
  const { valuations, refresh: refreshQuotes, loading: quotesLoading } = useRealtimeQuotes(quoteCodes, 0)

  // ─── K 线刷新 ─────────────────────────────────
  const handleRefreshKline = useCallback(async () => {
    if (!fund) return
    setRefreshing((s) => ({ ...s, kline: true }))
    await deleteKlineCache(`etf_${etfCode}`, period)
    await deleteKlineCache(fund.code, period)
    setKlineData([])
    setKlineRefreshKey((k) => k + 1)
    setRefreshing((s) => ({ ...s, kline: false }))
  }, [fund, etfCode, period])

  const handleRefreshPortfolio = useCallback(async () => {
    if (!fund) return
    setRefreshing((s) => ({ ...s, portfolio: true }))
    await deletePortfolioCache(fund.code)
    setPortfolioLoading(true)
    setPortfolio(null)
    setPortfolioRefreshKey((k) => k + 1)
    setRefreshing((s) => ({ ...s, portfolio: false }))
  }, [fund])

  // 刷新行情缓存
  const handleRefreshQuotes = useCallback(async () => {
    if (!fund) return
    setRefreshing((s) => ({ ...s, quotes: true }))
    await deleteQuotesCache()
    await refreshQuotes()
    setRefreshing((s) => ({ ...s, quotes: false }))
  }, [fund, refreshQuotes])

  // ─── K 线数据加载 ─────────────────────────────
  useEffect(() => {
    if (!fund) return
    let cancelled = false
    setKlineLoading(true)
    const timer = setTimeout(() => { if (!cancelled) setKlineLoading(false) }, 15000)

    const load = async () => {
      const etfCacheKey = `etf_${etfCode}`
      const navCacheKey = fund.code
      const [cached, navCached] = await Promise.all([
        getKlineCache(etfCacheKey, period),
        getKlineCache(navCacheKey, period),
      ])
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
  }, [fund?.code, period, etfCode, useEtfKline, klineRefreshKey])

  // ─── 形态检测 + 评分 ──────────────────────────
  useEffect(() => {
    if (klineData.length === 0) return
    const patterns = detectPatterns(klineData)
    setKlineDetectedPatterns(patterns)
    setKlinePatterns(formatPatternsSummary(patterns, klineData))
    setKlineAnalysis(null); setKlineAnalysisError(null)
    setSignalResult(evaluateSignal(klineData, patterns))
  }, [klineData])

  // ─── AI 分析 ──────────────────────────────────
  const handleAnalyzeKline = useCallback(async () => {
    if (!fund || klineData.length === 0) return
    setKlineAnalyzing(true); setKlineAnalysisError(null)
    try {
      const { result, usedAI, error } = await analyzeKline({
        code: fund.code, name: fund.name || fund.code, klineData, period,
        costNAV: fund.costNAV, currentNAV: valuations[fund.code]?.quote?.nav, shares: fund.shares,
      })
      setKlineAnalysis(result)
      if (!usedAI && error) setKlineAnalysisError(error)
    } catch (e) { setKlineAnalysisError(e instanceof Error ? e.message : '分析失败') }
    setKlineAnalyzing(false)
  }, [fund, klineData, period, valuations])

  // ─── 持仓穿透 ─────────────────────────────────
  useEffect(() => {
    if (!fund) return
    let cancelled = false
    // 切换基金时立即清空旧重仓股数据，避免新旧数据混用
    setPortfolio(null)
    setPortfolioLoading(true)
    const load = async () => {
      const cached = await getPortfolioCache(fund.code)
      const hasValidRatio = (cached?.holdings ?? []).some((h) => h.ratio > 0)
      if (!cancelled && cached && hasValidRatio) {
        setPortfolio(cached); setPortfolioLoading(false); return
      }
      // 缓存为空或全 0 比例时清理，避免旧脏缓存阻塞后续刷新
      if (cached && !hasValidRatio) {
        await deletePortfolioCache(fund.code)
      }
      const data = await dataSourceService.fetchFundPortfolio(fund.code)
      const dataHasValidRatio = (data?.holdings ?? []).some((h) => h.ratio > 0)
      if (!cancelled && data && data.holdings.length > 0 && dataHasValidRatio) {
        await setPortfolioCache(fund.code, data)
        setPortfolio(data)
      }
      if (!cancelled) setPortfolioLoading(false)
    }
    load()
    return () => { cancelled = true }
  // 用 fund?.code 代替 fund（对象引用 → 字符串值比较），避免 holdings 数组引用变化
  // 导致 fund 对象引用变化、effect 反复取消重跑
  }, [fund?.code, portfolioRefreshKey])

  // ─── Prompt ───────────────────────────────────
  const handleGenerate = useCallback(() => {
    if (!fund) return
    const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund.code)
    const klineDataMap: Record<string, KLineData[]> = {}
    for (const m of etfMappingsForFund) { if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData }
    const quotes = Object.values(valuations).map((v) => v.quote).filter(Boolean) as any[]
    const result = generatePrompt({
      templateType, holdings: [fund], quotes, selectedIds: [fund.id], etfMappings, alerts,
      klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
    })
    setPrompt(result); setCopied(false)
  }, [fund, templateType, valuations, etfMappings, alerts, klineData])

  const handleGenerateKlinePrompt = useCallback(() => {
    setTemplateType('kline_enhanced')
    setTimeout(() => {
      const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund?.code)
      const klineDataMap: Record<string, KLineData[]> = {}
      for (const m of etfMappingsForFund) { if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData }
      const quotes = Object.values(valuations).map((v) => v.quote).filter(Boolean) as any[]
      const result = generatePrompt({
        templateType: 'kline_enhanced', holdings: fund ? [fund] : [], quotes,
        selectedIds: fund ? [fund.id] : [], etfMappings, alerts,
        klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
      })
      setPrompt(result); setCopied(false)
    }, 0)
  }, [fund, valuations, etfMappings, alerts, klineData])

  const handleCopy = useCallback(async () => {
    if (!prompt) return
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch {
      const ta = document.createElement('textarea'); ta.value = prompt
      document.body.appendChild(ta); ta.select(); document.execCommand('copy')
      document.body.removeChild(ta); setCopied(true); setTimeout(() => setCopied(false), 2000)
    }
  }, [prompt])

  // ─── 空状态 ───────────────────────────────────
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
      {/* 标题行：基金名称 + 标签（左侧），基金切换下拉（右侧） */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">{fund.name || fund.code}</h1>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{fund.code}</span>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className="text-[10px]">{MARKET_LABELS[fund.market] || fund.market}</Badge>
            <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[fund.type] || fund.type}</Badge>
            <Badge variant="outline" className="text-[10px]">{SECTOR_LABELS[fund.sector] || fund.sector}</Badge>
            {etfCode && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">ETF {etfCode}</Badge>}
          </div>
        </div>
        <SearchableSelect
          options={holdings.map((h) => ({
            value: h.id,
            label: `${h.code} ${h.name || h.code}`,
            searchText: `${h.code} ${h.name || h.code}`.toLowerCase(),
          }))}
          value={fund.id}
          onValueChange={handleSwitchFund}
          placeholder="搜基金代码/名称..."
          className="w-[220px] sm:w-[280px] shrink-0"
        />
      </div>

      {/* 持仓信息 + 调仓/编辑 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />持仓信息
            </CardTitle>
            <div className="flex items-center gap-2">
              <RefreshButton onClick={handleRefreshQuotes} loading={refreshing.quotes} title="刷新行情" label="刷新行情" />
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
          {(() => {
            const val = valuations[fund.code]
            const q = val?.quote
            // 有效净值必须 > 1 且不是默认值 1.0000
            const currentNAV = (q?.nav && q.nav > 0.001 && q.nav !== 1) ? q.nav : null

            // 方式一：成本净值 × 份额
            const costByShares = fund.costNAV && fund.shares ? fund.costNAV * fund.shares : 0
            // 方式二：持有金额 - 持有收益（即成本）
            const costByProfit = fund.holdingAmount != null && fund.holdingProfit != null
              ? fund.holdingAmount - fund.holdingProfit : 0
            // 实际投入本金（优先方式一）
            const investment = costByShares || costByProfit || 0

            // 如果通过方式二录入且无份额，从持有金额反算份额
            const derivedShares = fund.shares || (currentNAV && currentNAV > 0
              ? Math.round((fund.holdingAmount || 0) / currentNAV * 100) / 100
              : 0)

            // 持仓成本单价：优先用户录入，否则反算（使用真实份额或反算份额）
            const activeShares = fund.shares || derivedShares
            const costNAV = fund.costNAV 
              || (investment && fund.shares ? investment / fund.shares : 0) 
              || (investment && derivedShares && derivedShares > 0 ? investment / derivedShares : 0) 
              || 0

            // 当前市值 = 份额 × 最新净值（优先），否则用持有金额，最后用成本
            const currentMarketValue = (activeShares && currentNAV)
              ? activeShares * currentNAV
              : (fund.holdingAmount || investment || 0)

            const profit = currentMarketValue - investment
            const returnRate = investment > 0 ? (profit / investment) * 100 : 0
            const isProfit = profit >= 0
          
          return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <Item label="持有份额" value={fund.shares ? fund.shares.toLocaleString() : (derivedShares ? `≈${derivedShares.toLocaleString()}` : '-')} />
                <Item label="持仓成本单价" value={costNAV > 0 ? `¥${costNAV.toFixed(4)}` : '-'} />
                <Item label={`最新净值${q?.navDate ? `(${q.navDate.slice(5)})` : ''}`}
                  value={<>{currentNAV ? `¥${currentNAV.toFixed(4)}` : '-'}{q?.dailyChange != null && currentNAV && (
                    <span className={`ml-1 text-[10px] ${pnlColor(q.dailyChange)}`}>
                      {formatSigned(q.dailyChange)}{q.dailyChange.toFixed(2)}%
                    </span>)}</>} />
                <Item label="投入本金" value={investment ? `¥${investment.toFixed(2)}` : '-'} />
                <Item label="当前市值" value={currentMarketValue ? `¥${currentMarketValue.toFixed(2)}` : '-'} />
                <Item label="浮动盈亏" value={profit ? `${formatSigned(profit)}¥${profit.toFixed(2)}` : '-'}
                  className={pnlColor(isProfit)} />
                <Item label="收益率" value={investment > 0 ? `${isProfit ? '+' : ''}${returnRate.toFixed(2)}%` : '-'}
                  className={pnlColor(isProfit)} />
                <Item label="购买日期" value={fund.purchaseDate || '-'} />
              </div>
            )
          })()}
        </CardContent>
      </Card>

      <EditFundDialog fund={fund} open={editOpen} onOpenChange={setEditOpen} />
      <QuickAdjustDialog fund={fund} open={adjustOpen} onOpenChange={setAdjustOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4">
          <KlineChartCard
            klineData={klineData} klineLoading={klineLoading} klineUpdateTime={klineUpdateTime}
            etfCode={etfCode} etfQuote={etfCode ? valuations[etfCode]?.quote || null : null}
            onRefreshQuote={handleRefreshQuotes} quoteRefreshing={refreshing.quotes}
            useEtfKline={useEtfKline} setUseEtfKline={setUseEtfKline}
            period={period} setPeriod={setPeriod}
            showMA={showMA} setShowMA={setShowMA} showBollinger={showBollinger} setShowBollinger={setShowBollinger}
            refreshing={refreshing} handleRefreshKline={handleRefreshKline}
            klineDetectedPatterns={klineDetectedPatterns} onHover={setHoveredKlineIndex}
            externalHighlightIndex={effectiveKlineHighlight}
            onCandleClick={handlePatternClick}
          />
          <KlinePatternCard
            klineData={klineData} klineDetectedPatterns={klineDetectedPatterns} klinePatterns={klinePatterns}
            klineAnalysis={klineAnalysis} klineAnalyzing={klineAnalyzing} klineAnalysisError={klineAnalysisError}
            hoveredKlineIndex={hoveredKlineIndex}
            selectedKlineIndex={selectedKlineIndex}
            onPatternHover={setHoveredKlineIndex}
            onPatternSelect={handlePatternClick}
            onAnalyzeKline={handleAnalyzeKline} onGenerateKlinePrompt={handleGenerateKlinePrompt}
          />
          <SignalScoreCard signalResult={signalResult} showSignalDetail={showSignalDetail} setShowSignalDetail={setShowSignalDetail} />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* 重仓股 */}
          {fund && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">重仓股</CardTitle>
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">前 10 大</span>
                  </div>
                  <RefreshButton onClick={handleRefreshPortfolio} loading={refreshing.portfolio} title="刷新重仓股" label="刷新" />
                </div>
              </CardHeader>
              <CardContent>
                {portfolioLoading ? (
                  <div className="flex items-center justify-center h-16"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : portfolio && portfolio.holdings.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground">报告期：{portfolio.date}</p>
                    <div className="space-y-1">
                      {portfolio.holdings.map((h, i) => (
                        <div
                          key={h.code}
                          onClick={() => navigate(`/stock/${h.code}`)}
                          className="group flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/40 cursor-pointer transition-colors"
                          title="查看个股详情"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-[10px] text-muted-foreground w-4 text-right">{i + 1}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{h.code}</span>
                            <span className="truncate group-hover:text-foreground">{h.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`font-mono font-medium ${h.ratio >= 5 ? 'text-red-500' : ''}`}>
                              {h.ratio.toFixed(1)}%
                            </span>
                            <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">暂无重仓股数据</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Prompt 模板 */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Prompt 模板</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                {(['diagnostic', 'rebalance', 'kline_enhanced'] as const).map((t) => (
                  <button key={t} onClick={() => setTemplateType(t)} title={TEMPLATE_HINTS[t]}
                    className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                      templateType === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
                    }`}>
                    {t === 'diagnostic' ? '诊断' : t === 'rebalance' ? '调仓' : 'K线'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{TEMPLATE_HINTS[templateType]}</p>
              <Button size="sm" className="w-full" disabled={quotesLoading} onClick={handleGenerate}>
                <Sparkles className="h-3 w-3 mr-1" />生成分析 Prompt
              </Button>
            </CardContent>
          </Card>

          {/* Prompt 预览 */}
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Prompt 预览</CardTitle>
                <Button variant="outline" size="sm" className="h-6 text-xs" disabled={!prompt} onClick={handleCopy}>
                  {copied ? <><CheckCircle className="h-3 w-3 mr-1 text-green-500" />已复制</>
                    : <><Copy className="h-3 w-3 mr-1" />复制</>}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {prompt ? (
                <Textarea value={prompt} readOnly className="min-h-[200px] text-xs font-mono leading-relaxed" />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">点击「生成」创建分析 Prompt</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** 持仓信息项 */
function Item({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${className}`}>{value}</p>
    </div>
  )
}
