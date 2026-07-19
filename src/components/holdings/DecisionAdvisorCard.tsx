/**
 * 决策建议卡 — 融合形态/指标/评分/策略后的唯一决策出口
 *
 * 展示：评级徽章(涨红跌绿) + 0-100 综合评分 + 多空力量条 + 一致性/冲突警示
 * + 买入理由(看多证据) + 风险因子(看空证据) + 命中命名策略 + 人话总结。
 * 原有三张卡（综合评分/技术指标/形态）降级为"分析明细"，可折叠查看。
 *
 * @module DecisionAdvisorCard
 */

import { useMemo } from 'react'
import { AlertTriangle, ThumbsUp, ThumbsDown, Sparkles, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { KLineData } from '@/types'
import type { DetectedPattern } from '@/services/klinePatterns'
import type { SignalResult } from '@/services/signalEngine'
import { computeStockSdkIndicators } from '@/services/stockSdkIndicators'
import { evaluateStrategies } from '@/services/strategyLayer'
import { buildDecision } from '@/services/decision/decisionEngine'
import type { SignalCategory } from '@/services/decision/types'

interface Props {
  klines: KLineData[]
  patterns: DetectedPattern[]
  signalResult: SignalResult | null
  /** 是否场内 ETF 真实 K 线；false 表示净值走势（置信度低） */
  isRealKline?: boolean
}

const CAT_LABEL: Record<SignalCategory, string> = {
  trend: '趋势',
  macd: 'MACD',
  momentum: '动量',
  bias: '乖离',
  volume: '量能',
  pattern: '形态',
}

const RATING_STYLE: Record<'up' | 'down' | 'neutral', { text: string; bg: string; border: string }> = {
  up: { text: 'text-up', bg: 'bg-up/10', border: 'border-up/30' },
  down: { text: 'text-down', bg: 'bg-down/10', border: 'border-down/30' },
  neutral: { text: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
}

export function DecisionAdvisorCard({ klines, patterns, signalResult, isRealKline = true }: Props) {
  const decision = useMemo(() => {
    if (klines.length === 0) return null
    const ind = computeStockSdkIndicators(klines)
    const strategies = evaluateStrategies(klines, ind)
    return buildDecision({ klines, patterns, signalResult, ind, strategies, lowConfidence: !isRealKline })
  }, [klines, patterns, signalResult, isRealKline])

  if (!decision) return null

  const style = RATING_STYLE[decision.ratingColor]
  const bullPct = Math.round(decision.bullRatio * 100)
  const bearPct = 100 - bullPct

  return (
    <Card className="card-hover border-2 border-primary/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          智能决策建议
          <span className="text-[10px] font-normal text-muted-foreground/60 ml-auto">形态·指标·评分·策略 融合</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 评级 + 评分 */}
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-lg text-base font-bold border ${style.text} ${style.bg} ${style.border}`}>
            {decision.ratingLabel}
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">综合评分 (0-100)</span>
            <span className={`text-lg font-bold leading-none ${style.text}`}>{decision.score}</span>
          </div>
          {decision.lowConfidence && (
            <span className="ml-auto text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/40">
              净值模式·置信度低
            </span>
          )}
        </div>

        {/* 多空力量条 */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span className="text-up">多头 {bullPct}%</span>
            <span className="text-down">空头 {bearPct}%</span>
          </div>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted/40">
            <div className="h-full bg-up transition-all duration-500" style={{ width: `${bullPct}%` }} />
            <div className="h-full bg-down transition-all duration-500" style={{ width: `${bearPct}%` }} />
          </div>
        </div>

        {/* 冲突 / 趋势警示 */}
        {(decision.conflict || decision.trendBearish) && (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {decision.conflict && '多空信号分歧较大，结论可靠性下降，建议以观望为主。'}
              {decision.conflict && decision.trendBearish && ' '}
              {decision.trendBearish && '当前处于空头排列趋势，反弹空间受限，不宜追高。'}
            </span>
          </div>
        )}

        {/* 人话总结 */}
        <p className="text-[11px] text-foreground/80 leading-relaxed bg-muted/15 rounded px-2 py-1.5">
          {decision.summary}
        </p>

        {/* 买入理由 / 风险因子 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ReasonColumn
            icon={<ThumbsUp className="h-3.5 w-3.5 text-up" />}
            title="买入理由"
            titleClass="text-up"
            items={decision.bullReasons}
          />
          <ReasonColumn
            icon={<ThumbsDown className="h-3.5 w-3.5 text-down" />}
            title="风险因子"
            titleClass="text-down"
            items={decision.bearReasons}
          />
        </div>

        {/* 命中策略 */}
        {decision.strategies.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />命中策略
            </div>
            <div className="flex flex-wrap gap-1.5">
              {decision.strategies.map((s) => (
                <span
                  key={s.id}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    s.direction === 'bull'
                      ? 'text-up bg-up/10 border-up/30'
                      : s.direction === 'bear'
                        ? 'text-down bg-down/10 border-down/30'
                        : 'text-muted-foreground bg-muted/30 border-border/40'
                  }`}
                  title={s.detail}
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] text-muted-foreground/40 text-right">技术分析仅供参考，不构成投资建议</p>
      </CardContent>
    </Card>
  )
}

function ReasonColumn({
  icon,
  title,
  titleClass,
  items,
}: {
  icon: React.ReactNode
  title: string
  titleClass: string
  items: { label: string; detail: string; category: SignalCategory }[]
}) {
  return (
    <div className="rounded-md border border-border/50 p-2">
      <div className={`flex items-center gap-1 text-[11px] font-semibold mb-1.5 ${titleClass}`}>
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60">暂无显著信号</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-[10px] leading-snug">
              <span className="inline-block text-[9px] text-muted-foreground/50 mr-1 px-1 rounded bg-muted/40 align-middle">
                {CAT_LABEL[it.category]}
              </span>
              <span className="text-foreground/80">{it.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
