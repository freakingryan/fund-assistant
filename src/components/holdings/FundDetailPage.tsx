import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { useSettingsStore } from '@/stores/settings'
import { dataSourceService } from '@/adapters/datasource/service'
import { generatePrompt, type PromptTemplateType } from '@/services/prompt'
import { getKlineCache, setKlineCache, deleteKlineCache, getKlineCacheTime, getPortfolioCache, setPortfolioCache, deletePortfolioCache, getPortfolioCacheTime, getQuotesCache, setQuotesCache, formatCacheTime } from '@/services/klineCache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import CandlestickChart from '@/components/dashboard/CandlestickChart'
import { Loader2, ArrowLeft, Copy, Sparkles, CheckCircle, FileText } from 'lucide-react'

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
  // 持仓穿透（带缓存）
  const [portfolio, setPortfolio] = useState<{ date: string; holdings: { code: string; name: string; ratio: number; value: number }[] } | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioUpdateTime, setPortfolioUpdateTime] = useState<string | null>(null)

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
    const result = generatePrompt({
      templateType,
      holdings: [fund],
      quotes,
      selectedIds: [fund.id],
      etfMappings,
      alerts,
    })
    setPrompt(result)
    setCopied(false)
  }, [fund, templateType, quotes, etfMappings, alerts])

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
                <CandlestickChart data={klineData} width={560} height={320} />
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

          {/* 持仓穿透 */}
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
              ) : portfolio?.holdings && portfolio.holdings.length > 0 ? (
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
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">暂无重仓股数据</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Prompt */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Prompt 模板</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                {(['diagnostic', 'rebalance', 'kline_enhanced'] as const).map((t) => (
                  <button key={t}
                    onClick={() => setTemplateType(t)}
                    className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                      templateType === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
                    }`}
                  >
                    {t === 'diagnostic' ? '诊断' : t === 'rebalance' ? '调仓' : 'K线'}
                  </button>
                ))}
              </div>
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
