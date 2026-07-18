import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { dataSourceService } from '@/adapters/datasource/service'
import {
  getKlineCache, setKlineCache, deleteKlineCache, getKlineCacheTime, formatCacheTime,
} from '@/services/klineCache'
import type { KLineData, FundQuote } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { RefreshButton } from '@/components/ui/refresh-button'
import KlineChartCard from '@/components/holdings/KlineChartCard'
import KlinePatternCard from '@/components/holdings/KlinePatternCard'
import SignalScoreCard from '@/components/holdings/SignalScoreCard'
import { TechnicalIndicatorsPanel } from '@/components/holdings/TechnicalIndicatorsPanel'
import { detectPatterns, formatPatternsSummary } from '@/services/klinePatterns'
import type { DetectedPattern } from '@/services/klinePatterns'
import { analyzeKline } from '@/services/klineAnalysis'
import type { KlineAnalysisResult } from '@/services/klineAnalysis'
import { evaluateSignal } from '@/services/signalEngine'
import type { SignalResult } from '@/services/signalEngine'
import { pnlColor } from '@/lib/format'

const PERIOD_LABELS: Record<string, string> = { '1m': '近1月', '3m': '近3月', '6m': '近6月', '1y': '近1年' }

/** 根据普通股票代码推断市场 */
function getMarketLabel(code: string): string {
  const f = code[0]
  if (f === '6' || f === '9') return '沪市'
  if (f === '0' || f === '2' || f === '3') return '深市'
  if (f === '8' || f === '4') return '北交所'
  if (f === '5') return '场内'
  return '其他'
}

export default function StockDetailPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  // ─── 状态 ─────────────────────────────────────
  const [name, setName] = useState(code || '')
  const [period, setPeriod] = useState('3m')
  const [klineData, setKlineData] = useState<KLineData[]>([])
  const [klineLoading, setKlineLoading] = useState(false)
  const [klineUpdateTime, setKlineUpdateTime] = useState<string | null>(null)
  const [klineRefreshKey, setKlineRefreshKey] = useState(0)
  const [showMA, setShowMA] = useState(true)
  const [showBollinger, setShowBollinger] = useState(false)
  const [refreshing, setRefreshing] = useState({ kline: false, quote: false })
  const [quote, setQuote] = useState<FundQuote | null>(null)
  const [klineDetectedPatterns, setKlineDetectedPatterns] = useState<DetectedPattern[]>([])
  const [klinePatterns, setKlinePatterns] = useState<string>('')
  const [klineAnalysis, setKlineAnalysis] = useState<KlineAnalysisResult | null>(null)
  const [klineAnalyzing, setKlineAnalyzing] = useState(false)
  const [klineAnalysisError, setKlineAnalysisError] = useState<string | null>(null)
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null)
  const [showSignalDetail, setShowSignalDetail] = useState(false)
  const [hoveredKlineIndex, setHoveredKlineIndex] = useState<number | null>(null)
  const [selectedKlineIndex, setSelectedKlineIndex] = useState<number | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)

  const effectiveKlineHighlight = useMemo(() => selectedKlineIndex ?? hoveredKlineIndex, [selectedKlineIndex, hoveredKlineIndex])

  const handlePatternClick = useCallback((index: number | null) => {
    setSelectedKlineIndex((prev) => prev === index ? null : index)
  }, [])

  useEffect(() => {
    if (selectedKlineIndex === null) return
    const handler = () => setSelectedKlineIndex(null)
    const timer = setTimeout(() => document.addEventListener('click', handler, { once: true }), 100)
    return () => { clearTimeout(timer); document.removeEventListener('click', handler) }
  }, [selectedKlineIndex])

  // ─── 股票名称 ─────────────────────────────────
  useEffect(() => {
    if (!code) return
    let cancelled = false
    ;(async () => {
      const info = await dataSourceService.fetchFundInfo(code)
      if (!cancelled && info && info.name !== code) setName(info.name)
    })()
    return () => { cancelled = true }
  }, [code])

  // ─── 实时行情 ─────────────────────────────────
  const handleRefreshQuote = useCallback(async () => {
    if (!code) return
    setRefreshing((s) => ({ ...s, quote: true }))
    const q = await dataSourceService.fetchStockQuote(code)
    if (q) setQuote(q)
    setRefreshing((s) => ({ ...s, quote: false }))
  }, [code])

  useEffect(() => { handleRefreshQuote() }, [handleRefreshQuote])

  // ─── K 线数据加载 ─────────────────────────────
  useEffect(() => {
    if (!code) return
    let cancelled = false
    const cacheKey = `stock_${code}`
    setKlineLoading(true)
    const timer = setTimeout(() => { if (!cancelled) setKlineLoading(false) }, 15000)

    const load = async () => {
      const cached = await getKlineCache(cacheKey, period)
      if (!cancelled && cached?.length) {
        clearTimeout(timer); setKlineData(cached); setKlineLoading(false)
        getKlineCacheTime(cacheKey, period).then((ts) => ts && setKlineUpdateTime(formatCacheTime(ts)))
        return
      }
      const data = await dataSourceService.fetchStockKLine(code, period)
      if (!cancelled) {
        if (data.length > 0) { setKlineCache(cacheKey, period, data); setKlineUpdateTime(formatCacheTime(Date.now())) }
        clearTimeout(timer)
        setKlineData(data)
        setKlineLoading(false)
      }
    }
    load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [code, period, klineRefreshKey])

  // ─── 形态检测 + 评分 ──────────────────────────
  useEffect(() => {
    if (klineData.length === 0) return
    const patterns = detectPatterns(klineData)
    setKlineDetectedPatterns(patterns)
    setKlinePatterns(formatPatternsSummary(patterns, klineData))
    setKlineAnalysis(null); setKlineAnalysisError(null)
    setSignalResult(evaluateSignal(klineData, patterns))
  }, [klineData])

  // ─── K 线刷新 ─────────────────────────────────
  const handleRefreshKline = useCallback(async () => {
    if (!code) return
    setRefreshing((s) => ({ ...s, kline: true }))
    await deleteKlineCache(`stock_${code}`, period)
    setKlineData([])
    setKlineRefreshKey((k) => k + 1)
    setRefreshing((s) => ({ ...s, kline: false }))
  }, [code, period])

  // ─── AI 分析 ──────────────────────────────────
  const handleAnalyzeKline = useCallback(async () => {
    if (!code || klineData.length === 0) return
    setKlineAnalyzing(true); setKlineAnalysisError(null)
    try {
      const { result, usedAI, error } = await analyzeKline({
        code, name: name || code, klineData, period,
      })
      setKlineAnalysis(result)
      if (!usedAI && error) setKlineAnalysisError(error)
    } catch (e) { setKlineAnalysisError(e instanceof Error ? e.message : '分析失败') }
    setKlineAnalyzing(false)
  }, [code, name, klineData, period])

  // ─── 生成 K 线 Prompt（复制到剪贴板）──────────
  const handleGenerateKlinePrompt = useCallback(async () => {
    const parts = [
      `【${name || code} (${code}) K 线技术分析】`,
      `周期：${PERIOD_LABELS[period] || period}`,
      signalResult ? `综合评分：${signalResult.totalScore}（${signalResult.advice}）` : '',
      klinePatterns ? `检测到的形态：\n${klinePatterns}` : '',
      klineAnalysis?.advice ? `AI 建议：${klineAnalysis.advice}` : '',
    ].filter(Boolean)
    const text = parts.join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setPromptCopied(true)
      setTimeout(() => setPromptCopied(false), 2000)
    } catch { /* ignore */ }
  }, [name, code, period, signalResult, klinePatterns, klineAnalysis])

  if (!code) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/holdings')}><ArrowLeft className="h-3 w-3 mr-1" />返回持仓</Button>
        <Card><CardContent className="text-center py-16"><p className="text-muted-foreground">股票代码缺失</p></CardContent></Card>
      </div>
    )
  }

  const quoteColor = quote?.dailyChange != null
    ? pnlColor(quote.dailyChange)
    : 'text-foreground'

  return (
    <div className="space-y-6">
      {/* 标题行 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">{name || code}</h1>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{code}</span>
          <Badge variant="secondary" className="text-[10px]">{getMarketLabel(code)}</Badge>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3 w-3 mr-1" />返回
        </Button>
      </div>

      {/* 实时行情 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            {quote ? (
              <>
                <span className={`text-2xl font-bold font-mono ${quoteColor}`}>
                  ¥{quote.nav.toFixed(2)}
                </span>
                <span className={`text-sm font-medium font-mono ${quoteColor}`}>
                  {quote.dailyChange >= 0 ? '+' : ''}{quote.dailyChange.toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">加载行情中…</span>
            )}
            <RefreshButton onClick={handleRefreshQuote} loading={refreshing.quote} title="刷新行情" label="刷新行情" className="ml-auto" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左列：K 线 + 形态 + 评分 */}
        <div className="lg:col-span-2 space-y-4">
          <KlineChartCard
            isStock
            klineData={klineData} klineLoading={klineLoading} klineUpdateTime={klineUpdateTime}
            etfCode={null}
            onRefreshQuote={handleRefreshQuote} quoteRefreshing={refreshing.quote}
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
          <TechnicalIndicatorsPanel klines={klineData} />
        </div>

        {/* 右列：说明 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">数据说明</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>• K 线走势与实时行情来自 stock-api（腾讯 / 新浪 / 东方财富自动兜底）。</p>
              <p>• 综合评分由信号引擎基于 MA / MACD / RSI / BOLL / 量能 / K 线形态加权计算。</p>
              <p>• 点击 K 线蜡烛或形态记录可高亮联动查看。</p>
              {promptCopied && (
                <p className="flex items-center gap-1 text-green-500"><CheckCircle className="h-3 w-3" />Prompt 已复制到剪贴板</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
