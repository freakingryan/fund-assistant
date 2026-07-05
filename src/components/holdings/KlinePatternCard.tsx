import { useState } from 'react'
import type { KLineData } from '@/types'
import type { DetectedPattern } from '@/services/klinePatterns'
import type { KlineAnalysisResult } from '@/services/klineAnalysis'
import { getPatternLabel } from '@/services/klinePatterns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, BrainCircuit, MessageSquareText, Sparkles } from 'lucide-react'

interface Props {
  klineData: KLineData[]
  klineDetectedPatterns: DetectedPattern[]
  klinePatterns: string
  klineAnalysis: KlineAnalysisResult | null
  klineAnalyzing: boolean
  klineAnalysisError: string | null
  hoveredKlineIndex: number | null
  onPatternHover?: (index: number | null) => void
  onPatternSelect?: (index: number | null) => void
  onAnalyzeKline: () => void
  onGenerateKlinePrompt: () => void
}

export default function KlinePatternCard({
  klineData, klineDetectedPatterns, klinePatterns,
  klineAnalysis, klineAnalyzing, klineAnalysisError,
  hoveredKlineIndex, onPatternHover, onPatternSelect, onAnalyzeKline, onGenerateKlinePrompt,
}: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  return (
    <Card>
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
                  const isHovered = hoveredKlineIndex === p.index
                  return (
                    <div key={`${p.type}-${p.index}-${i}`}
                      className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors cursor-pointer ${isHovered ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40'}`}
                      onMouseEnter={() => onPatternHover?.(p.index)}
                      onMouseLeave={() => onPatternHover?.(null)}
                      onClick={() => onPatternSelect?.(hoveredKlineIndex === p.index ? null : p.index)}
                    >
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                        p.direction === 'bullish'
                          ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                          : p.direction === 'bearish'
                            ? 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400'
                            : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {getPatternLabel([p], p.index) || p.type}
                      </span>
                      <span className="text-muted-foreground text-[10px] shrink-0">{klineData[p.index]?.date || ''}</span>
                      <span className="text-muted-foreground truncate flex-1 min-w-0">{p.description}</span>
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
                klineAnalysis.trend === 'bullish' ? 'bg-red-50 text-red-600'
                  : klineAnalysis.trend === 'bearish' ? 'bg-green-50 text-green-600'
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
                  <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium">看涨吞没</span>
                  <span className="text-[9px] text-muted-foreground self-center">后阳包前阴，强势反转看涨</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium">看跌吞没</span>
                  <span className="text-[9px] text-muted-foreground self-center">后阴包前阳，强势反转看跌</span>
                </div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <p className="font-medium text-foreground mb-0.5">📌 3K 组合</p>
                <div className="mt-1 space-y-0.5">
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium shrink-0">晨星</span>
                    <span className="text-[9px] text-muted-foreground">大阴→小实体(星)→大阳，底部反转</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium shrink-0">暮星</span>
                    <span className="text-[9px] text-muted-foreground">大阳→小实体(星)→大阴，顶部反转</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium shrink-0">三连阳</span>
                    <span className="text-[9px] text-muted-foreground">连续三阳线，多头推进</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-start">
                    <span className="px-1 py-0.5 rounded bg-green-50 text-green-600 text-[9px] font-medium shrink-0">三连阴</span>
                    <span className="text-[9px] text-muted-foreground">连续三阴线，空头推进</span>
                  </div>
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
  )
}
