import { useState } from 'react'
import type { KLineData, FundQuote } from '@/types'
import type { DetectedPattern } from '@/services/klinePatterns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCw } from 'lucide-react'
import CandlestickChart from '@/components/dashboard/CandlestickChart'

interface Props {
  klineData: KLineData[]
  klineLoading: boolean
  klineUpdateTime: string | null
  etfCode: string | null
  etfQuote?: FundQuote | null
  onRefreshQuote?: () => void
  quoteRefreshing?: boolean
  externalHighlightIndex?: number | null
  onCandleClick?: (index: number | null) => void
  useEtfKline: boolean
  setUseEtfKline: (v: boolean) => void
  period: string
  setPeriod: (v: string) => void
  showMA: boolean
  setShowMA: (v: boolean) => void
  showBollinger: boolean
  setShowBollinger: (v: boolean) => void
  refreshing: { kline: boolean }
  handleRefreshKline: () => void
  klineDetectedPatterns: DetectedPattern[]
  onHover: (index: number | null) => void
}

export default function KlineChartCard({
  klineData, klineLoading, klineUpdateTime, etfCode, etfQuote,
  onRefreshQuote, quoteRefreshing, externalHighlightIndex, onCandleClick,
  useEtfKline, setUseEtfKline, period, setPeriod,
  showMA, setShowMA, showBollinger, setShowBollinger,
  refreshing, handleRefreshKline,
  klineDetectedPatterns, onHover,
}: Props) {
  const [klineIndicatorInfoOpen, setKlineIndicatorInfoOpen] = useState(false)

  const hasValidEtfQuote = etfQuote && etfQuote.nav && etfQuote.nav > 0.001
  const etfQuoteChangeColor = hasValidEtfQuote && etfQuote.dailyChange >= 0 ? 'text-red-500' : 'text-green-500'

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm">K 线走势</CardTitle>
              {etfCode && (
                <Badge className="text-[10px] bg-red-100 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400">
                  实时
                </Badge>
              )}
            </div>
            {etfCode && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground">场内映射行情</span>
                {hasValidEtfQuote ? (
                  <>
                    <span className="font-medium">{etfQuote.name || `ETF ${etfCode}`}</span>
                    <span className="text-muted-foreground">{etfCode}</span>
                    <span className="font-mono font-medium">¥{etfQuote.nav.toFixed(4)}</span>
                    <span className={`font-mono font-medium ${etfQuoteChangeColor}`}>
                      {etfQuote.dailyChange >= 0 ? '+' : ''}{etfQuote.dailyChange.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">暂无实时数据</span>
                )}
              </div>
            )}
            {klineUpdateTime && (
              <span className="text-[10px] text-muted-foreground">K 线更新于 {klineUpdateTime}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {useEtfKline && etfCode && klineData[0]?.volume && (
              <>
                <button
                  onClick={() => setShowMA(!showMA)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    showMA ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-400 font-medium' : 'border-muted text-muted-foreground hover:bg-muted/50'
                  }`}
                >MA</button>
                <button
                  onClick={() => setShowBollinger(!showBollinger)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    showBollinger ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-400 font-medium' : 'border-muted text-muted-foreground hover:bg-muted/50'
                  }`}
                >BOLL</button>
              </>
            )}
            {onRefreshQuote && etfCode && (
              <button onClick={onRefreshQuote} disabled={quoteRefreshing}
                className="inline-flex items-center justify-center text-xs w-7 h-7 rounded-md hover:bg-muted/60 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="刷新行情">
                {quoteRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
            )}
            <button onClick={handleRefreshKline} disabled={refreshing.kline}
              className="inline-flex items-center justify-center text-xs w-7 h-7 rounded-md hover:bg-muted/60 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={useEtfKline ? '刷新K线' : '刷新净值'}>
              {refreshing.kline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-7 text-xs w-[62px]"><SelectValue /></SelectTrigger>
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
      <CardContent className="relative">
        {etfCode && (
          <div className="flex items-center gap-2 mb-3">
            <Switch id="etf-kline" checked={useEtfKline} onCheckedChange={setUseEtfKline} />
            <Label htmlFor="etf-kline" className="text-xs cursor-pointer">
              {useEtfKline ? '场内 ETF 真实 K 线' : '基金净值走势'} <span className="text-[10px] text-muted-foreground">（{etfCode}）</span>
            </Label>
          </div>
        )}
        {klineLoading ? (
          <div className="flex items-center justify-center h-[200px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : useEtfKline && etfCode && klineData[0]?.volume ? (
          <>
            {/* 可滚动容器：防止 SVG 在窄屏下撑破父容器 */}
            <div className="overflow-x-auto pb-1 -mx-1 px-1">
              <CandlestickChart data={klineData} width={560} height={320} patterns={klineDetectedPatterns} onHover={onHover} showMA={showMA} showBollinger={showBollinger} externalHighlightIndex={externalHighlightIndex} onCandleClick={onCandleClick} />
            </div>
            {(showMA || showBollinger) && klineData.length > 1 && (
              <div className="mt-1">
                <button
                  onClick={() => setKlineIndicatorInfoOpen(!klineIndicatorInfoOpen)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <span className={`inline-block transition-transform ${klineIndicatorInfoOpen ? 'rotate-90' : ''}`}>▶</span>
                  MA / BOLL 技术指标说明
                </button>
                {klineIndicatorInfoOpen && (
                  <div className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed space-y-2">
                    <p className="text-[9px] text-muted-foreground/60">
                      K 线数据范围：{klineData[0]?.date || '?'} ～ {klineData[klineData.length - 1]?.date || '?'}
                    </p>
                    {showMA && (() => {
                      const ma5Start = klineData[Math.min(4, klineData.length - 1)]?.date || '?'
                      const ma10Start = klineData[Math.min(9, klineData.length - 1)]?.date || '?'
                      const ma20Start = klineData[Math.min(19, klineData.length - 1)]?.date || '?'
                      const lastDate = klineData[klineData.length - 1]?.date || '?'
                      return (
                        <div className="p-2 rounded bg-muted/20">
                          <p className="font-medium text-foreground mb-0.5">📈 MA（移动平均线）</p>
                          <p>过去 N 个交易日收盘价的算术平均值，用于识别趋势方向和支撑/阻力位。</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span className="text-[9px]"><span className="font-medium" style={{ color: '#f59e0b' }}>MA5</span> {ma5Start}～{lastDate}</span>
                            <span className="text-[9px]"><span className="font-medium" style={{ color: '#3b82f6' }}>MA10</span> {ma10Start}～{lastDate}</span>
                            <span className="text-[9px]"><span className="font-medium" style={{ color: '#8b5cf6' }}>MA20</span> {ma20Start}～{lastDate}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground/70 mt-0.5">用法：价格在均线上方→短期偏强，下方→短期偏弱。MA5/10 金叉=买入信号，死叉=卖出信号。</p>
                        </div>
                      )
                    })()}
                    {showBollinger && (() => {
                      const bbStart = klineData[Math.min(19, klineData.length - 1)]?.date || '?'
                      const lastDate = klineData[klineData.length - 1]?.date || '?'
                      return (
                        <div className="p-2 rounded bg-muted/20">
                          <p className="font-medium text-foreground mb-0.5">📉 BOLL（布林带 / Bollinger Bands）</p>
                          <p>中轨=MA20，上/下轨=中轨 ± 2 倍标准差（σ）。反映价格波动区间。</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span className="text-[9px]"><span className="font-medium text-blue-600 dark:text-blue-400">BOLL(20,2)</span> {bbStart}～{lastDate}</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground/70 mt-0.5">用法：带宽变宽=波动加大，变窄（收口）=即将变盘。价格触及上轨=超买，触及下轨=超卖。</p>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-[200px]">
            {klineData.length > 0 ? (
              <svg width={560} height={200} className="overflow-visible">
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
  )
}
