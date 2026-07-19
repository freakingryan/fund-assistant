import { useState, useEffect } from 'react'
import type { KLineData } from '@/types'
import type { DetectedPattern } from '@/services/klinePatterns'
import type { KlineAnalysisResult } from '@/services/klineAnalysis'
import { getPatternDisplayName } from '@/services/klinePatterns'
import { pnlColor } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, BrainCircuit, MessageSquareText, Sparkles, CircleSlash } from 'lucide-react'

interface Props {
  klineData: KLineData[]
  klineDetectedPatterns: DetectedPattern[]
  klinePatterns: string
  klineAnalysis: KlineAnalysisResult | null
  klineAnalyzing: boolean
  klineAnalysisError: string | null
  hoveredKlineIndex: number | null
  selectedKlineIndex?: number | null
  onPatternHover?: (index: number | null) => void
  onPatternSelect?: (index: number | null) => void
  onAnalyzeKline: () => void
  onGenerateKlinePrompt: () => void
  /** 是否展示「场内 ETF 真实 K 线」；为 false（基金净值走势 / 真实K线加载中或失败）时隐藏形态分析具体内容 */
  isRealKline?: boolean
  /** 场内 ETF 代码（用于判断能否切换到真实 K 线） */
  etfCode?: string | null
  /** 是否正在尝试加载真实 K 线（意图开启但数据未就绪），用于显示「加载中」占位 */
  loading?: boolean
  /** 真实 K 线获取失败原因（接口冷却/网络异常），用于提示用户 */
  etfKlineError?: string | null
  /** 切换到「场内 ETF 真实 K 线」的回调 */
  onSwitchToRealKline?: () => void
}

export default function KlinePatternCard({
  klineData, klineDetectedPatterns, klinePatterns,
  klineAnalysis, klineAnalyzing, klineAnalysisError,
  hoveredKlineIndex, selectedKlineIndex, onPatternHover, onPatternSelect, onAnalyzeKline, onGenerateKlinePrompt,
  isRealKline = true, etfCode = null, loading = false, etfKlineError = null, onSwitchToRealKline,
}: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  // 触摸设备识别：无 hover 能力且指针为粗指（手机/平板）→ 用「点击切换」tooltip；
  // 桌面（有 hover）→ 用「悬停显示」tooltip。
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  // 当前展开的 tooltip 对应的 K 线索引（null = 全部收起）
  const [openTip, setOpenTip] = useState<number | null>(null)

  // 触摸模式下，点击记录外部区域关闭 tooltip（点击记录本身已在 onClick 中 stopPropagation）
  useEffect(() => {
    if (openTip === null || !isTouch) return
    const handler = () => setOpenTip(null)
    const t = setTimeout(() => document.addEventListener('click', handler, { once: true }), 120)
    return () => { clearTimeout(t); document.removeEventListener('click', handler) }
  }, [openTip, isTouch])

  // 非真实 K 线模式：
  //  - 正在加载真实 K 线 → 显示「加载中」，避免用旧的净值数据（无 OHLC）误判为十字星；
  //  - 加载失败/净值模式 → 隐藏具体形态内容，提示切换到「场内 ETF 真实 K 线」以获取准确分析。
  if (!isRealKline) {
    return (
      <Card className="card-hover">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BrainCircuit className="h-3.5 w-3.5" />K 线形态分析
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">K 线加载中，形态分析稍后展示…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <CircleSlash className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">当前为「基金净值走势」</p>
              {etfKlineError ? (
                <p className="text-[10px] text-orange-500 max-w-xs leading-relaxed">{etfKlineError}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground/70 max-w-xs leading-relaxed">
                  K 线形态分析需基于真实 K 线的开/收/高/低（OHLC）数据；净值序列无盘中区间，无法准确识别形态（易误判为十字星）。
                  切换到「场内 ETF 真实 K 线」可查看准确的形态分析。
                </p>
              )}
              {etfCode && onSwitchToRealKline && (
                <Button variant="outline" size="sm" className="h-7 text-xs mt-1" onClick={onSwitchToRealKline}>
                  切换到真实 K 线
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BrainCircuit className="h-3.5 w-3.5" />K 线形态分析
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={klineData.length === 0} onClick={onGenerateKlinePrompt}>
              <MessageSquareText className="h-3 w-3 mr-1" />生成 Prompt
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={klineAnalyzing || klineData.length === 0} onClick={onAnalyzeKline}>
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
        {/* 算法检测结果 */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">算法检测</p>
          {klineDetectedPatterns.length > 0 ? (
            <div className="space-y-0.5">
              {[...klineDetectedPatterns]
                .sort((a, b) => b.index - a.index)
                .map((p, i) => {
                  const isHighlighted = hoveredKlineIndex === p.index || selectedKlineIndex === p.index
                  const tipKline = klineData[p.index]
                  const tipStart = p.isMultiCandle && p.candleCount > 1 ? klineData[p.index - p.candleCount + 1] : null
                  const tipChange = tipKline && tipKline.open ? ((tipKline.close - tipKline.open) / tipKline.open) * 100 : 0
                  return (
                    <div key={`${p.type}-${p.index}-${i}`}
                      className={`relative flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors cursor-pointer ${isHighlighted ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40'}`}
                      onMouseEnter={() => { onPatternHover?.(p.index); if (!isTouch) setOpenTip(p.index) }}
                      onMouseLeave={() => { onPatternHover?.(null); if (!isTouch) setOpenTip(null) }}
                      onClick={(e) => { e.stopPropagation(); onPatternSelect?.(p.index); if (isTouch) setOpenTip((prev) => (prev === p.index ? null : p.index)) }}
                    >
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                        p.direction === 'bullish'
                          ? 'bg-up/10 text-up'
                          : p.direction === 'bearish'
                            ? 'bg-down/10 text-down'
                            : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {getPatternDisplayName(p) || p.type}
                      </span>
                      <span className="text-muted-foreground text-[10px] shrink-0">{klineData[p.index]?.date || ''}</span>
                      <span className="text-muted-foreground truncate flex-1 min-w-0">{p.description}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {p.isMultiCandle ? `${p.candleCount}K` : '单K'} · {(p.confidence * 100).toFixed(0)}%
                      </span>

                      {/* 完整信息 tooltip：桌面悬停 / 触摸点击切换 */}
                      {openTip === p.index && tipKline && (
                        <div className="absolute z-50 left-2 right-2 bottom-full mb-1 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-2 text-[10px] leading-relaxed">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium">{getPatternDisplayName(p)}</span>
                            <span className={`px-1 py-0.5 rounded text-[9px] ${
                              p.direction === 'bullish' ? 'bg-up/10 text-up'
                                : p.direction === 'bearish' ? 'bg-down/10 text-down'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {p.direction === 'bullish' ? '看涨' : p.direction === 'bearish' ? '看跌' : '中性'}
                            </span>
                          </div>
                          <p className="text-muted-foreground mb-1">{p.description}</p>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                            <span>日期：{tipKline.date}</span>
                            <span>置信度：{(p.confidence * 100).toFixed(0)}%</span>
                            <span>开：{tipKline.open.toFixed(3)}</span>
                            <span>收：{tipKline.close.toFixed(3)}</span>
                            <span>高：{tipKline.high.toFixed(3)}</span>
                            <span>低：{tipKline.low.toFixed(3)}</span>
                            <span className={pnlColor(tipChange)}>涨跌：{tipChange >= 0 ? '+' : ''}{tipChange.toFixed(2)}%</span>
                            <span>量：{tipKline.volume.toLocaleString()}</span>
                          </div>
                          {p.isMultiCandle && tipStart && (
                            <p className="text-muted-foreground mt-1">
                              组合区间：{tipStart.date} ~ {tipKline.date}（{p.candleCount} 根 K 线）
                            </p>
                          )}
                          {isTouch && <p className="text-[9px] text-muted-foreground/70 mt-1">点击其他区域关闭</p>}
                        </div>
                      )}
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
                klineAnalysis.trend === 'bullish' ? 'bg-up/10 text-up'
                  : klineAnalysis.trend === 'bearish' ? 'bg-down/10 text-down'
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
                <span className="text-up">支撑: ¥{klineAnalysis.support.toFixed(4)}</span>
                <span className="text-down">阻力: ¥{klineAnalysis.resistance.toFixed(4)}</span>
              </div>
            )}
            <div className="text-xs p-2 rounded bg-muted/30 leading-relaxed">{klineAnalysis.advice}</div>
            {klineAnalysisError && <p className="text-[10px] text-orange-500">注: {klineAnalysisError}，仅显示算法检测结果</p>}
          </div>
        )}

        {/* 术语说明 */}
        <div className="border-t pt-2">
          <button onClick={() => setGlossaryOpen(!glossaryOpen)}
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
                <p>两根连续 K 线，通过前后对比判断反转：</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className="px-1 py-0.5 rounded bg-up/10 text-up text-[9px] font-medium">看涨吞没</span>
                  <span className="text-[9px] text-muted-foreground self-center">后阳包前阴，强势反转看涨</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <span className="px-1 py-0.5 rounded bg-down/10 text-down text-[9px] font-medium">看跌吞没</span>
                  <span className="text-[9px] text-muted-foreground self-center">后阴包前阳，强势反转看跌</span>
                </div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <p className="font-medium text-foreground mb-0.5">📌 3K 组合</p>
                <div className="mt-1 space-y-0.5">
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-up/10 text-up text-[9px] font-medium shrink-0">晨星</span>
                    <span className="text-[9px] text-muted-foreground">大阴→小实体(星)→大阳，底部反转</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-down/10 text-down text-[9px] font-medium shrink-0">暮星</span>
                    <span className="text-[9px] text-muted-foreground">大阳→小实体(星)→大阴，顶部反转</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-up/10 text-up text-[9px] font-medium shrink-0">三连阳</span>
                    <span className="text-[9px] text-muted-foreground">连续三阳线，多头推进</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-down/10 text-down text-[9px] font-medium shrink-0">三连阴</span>
                    <span className="text-[9px] text-muted-foreground">连续三阴线，空头推进</span>
                  </div>
                </div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <p className="font-medium text-foreground mb-0.5">📌 其他术语</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
                  <span><span className="text-up font-medium">红色</span>=涨 (阳线)</span>
                  <span><span className="text-down font-medium">绿色</span>=跌 (阴线)</span>
                  <span>实体 = 开收盘价差</span>
                  <span>上/下影线 = 最高/低价与实体的差距</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
