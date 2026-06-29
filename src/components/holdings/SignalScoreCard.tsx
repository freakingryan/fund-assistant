import { useState } from 'react'
import type { SignalResult } from '@/services/signalEngine'
import { DEFAULT_WEIGHTS } from '@/services/signalEngine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'

interface Props {
  signalResult: SignalResult | null
  showSignalDetail: boolean
  setShowSignalDetail: (v: boolean) => void
}

/** 根据评分和指标生成调仓建议 */
function buildAdvice(signalResult: SignalResult): { label: string; color: string; details: string[] } {
  const score = signalResult.totalScore
  const rsiC = signalResult.contributions.find((c) => c.key === 'rsi')
  const bollC = signalResult.contributions.find((c) => c.key === 'bollinger')
  const maC = signalResult.contributions.find((c) => c.key === 'maTrend')
  const macdC = signalResult.contributions.find((c) => c.key === 'macdCross')
  const volC = signalResult.contributions.find((c) => c.key === 'volume')

  const isOverheat = (rsiC && rsiC.score <= -4) || (bollC && bollC.score <= -3)
  const isOversold = (rsiC && rsiC.score >= 4) || (bollC && bollC.score >= 3)
  const trendUp = (maC && maC.score >= 5) || (macdC && macdC.score >= 5)
  const trendDown = (maC && maC.score <= -5) || (macdC && macdC.score <= -5)
  const volSurge = volC && volC.score >= 3
  const volShrink = volC && volC.score <= -2

  const details: string[] = []

  if (score >= 60 && isOverheat) {
    details.push('评分虽高但 RSI/BOLL 提示过热，建议观望或分批止盈')
  } else if (score >= 60) {
    details.push('多头趋势强劲，可持有或分批止盈锁定利润')
  } else if (score >= 20 && isOversold) {
    details.push('趋势偏多 + 超卖信号，较好的补仓窗口')
  } else if (score >= 20) {
    details.push('趋势温和偏多，适合小额定投或分批建仓')
  } else if (score > -20) {
    details.push('多空信号不明确，建议等待方向确认后再操作')
  } else if (score > -60 && isOversold) {
    details.push('偏空但已出现超卖信号，观望等待企稳')
  } else if (score > -60) {
    details.push('偏空趋势，不建议补仓，已有仓位可考虑减仓')
  } else {
    details.push('强烈看空信号，减仓避险为主')
  }

  if (trendUp && isOversold) {
    details.push('📌 MA/MACD 偏多 + 超卖 = 趋势向上的回调买入机会')
  }
  if (trendDown && isOverheat) {
    details.push('📌 MA/MACD 偏空 + 超买 = 趋势向下的反弹减仓机会')
  }
  if (volSurge && score > 0) {
    details.push('📌 成交量放大配合多头信号，上涨有量能支持')
  }
  if (volShrink && score < 0) {
    details.push('📌 缩量下跌，抛压减弱，可能接近底部')
  }

  if (details.length === 0) details.push('信号混杂，建议结合其他信息综合判断')

  let label: string
  let color: string
  if (score >= 60) { label = '持有/分批止盈'; color = 'text-red-500' }
  else if (score >= 20) { label = '适合补仓/定投'; color = 'text-red-500' }
  else if (score > -20) { label = '观望等待'; color = 'text-muted-foreground' }
  else if (score > -60) { label = '减仓/观望'; color = 'text-green-500' }
  else { label = '减仓避险'; color = 'text-green-500' }

  return { label, color, details }
}

export default function SignalScoreCard({ signalResult, showSignalDetail, setShowSignalDetail }: Props) {
  const [showRef, setShowRef] = useState(false)
  if (!signalResult) return null
  const advice = buildAdvice(signalResult)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />综合评分
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 主评分 + 方向 */}
        <div className="flex items-center gap-2 mb-1">
          <div className={`text-base font-bold px-2 py-0.5 rounded ${
            signalResult.direction === 'strong_bullish' || signalResult.direction === 'bullish'
              ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
              : signalResult.direction === 'strong_bearish' || signalResult.direction === 'bearish'
                ? 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400'
                : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {signalResult.totalScore >= 0 ? '+' : ''}{signalResult.totalScore}
          </div>
          <span className={`text-sm font-bold ${
            signalResult.direction.startsWith('strong_bullish') || signalResult.direction === 'bullish'
              ? 'text-red-500' : signalResult.direction.startsWith('strong_bearish') || signalResult.direction === 'bearish'
                ? 'text-green-500' : 'text-muted-foreground'
          }`}>
            {signalResult.directionLabel}
          </span>
        </div>
        {/* 进度条 */}
        <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden mb-2">
          <div className="h-full rounded-full transition-all" style={{
            width: `${Math.abs(signalResult.totalScore)}%`,
            marginLeft: signalResult.totalScore < 0 ? `${(100 + signalResult.totalScore)}%` : '50%',
            background: signalResult.totalScore >= 0
              ? 'linear-gradient(90deg, #f87171, #ef4444)'
              : 'linear-gradient(90deg, #34d399, #10b981)',
          }} />
        </div>
        {/* 关键指标一览 */}
        {(() => {
          const rsiC = signalResult.contributions.find((c) => c.key === 'rsi')
          const macdC = signalResult.contributions.find((c) => c.key === 'macdCross')
          const maC = signalResult.contributions.find((c) => c.key === 'maTrend')
          const bollC = signalResult.contributions.find((c) => c.key === 'bollinger')
          const volC = signalResult.contributions.find((c) => c.key === 'volume')
          return (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
              {rsiC && (
                <span className={`text-[11px] font-medium ${rsiC.score >= 4 ? 'text-green-500' : rsiC.score <= -4 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  RSI {rsiC.detail.replace(/^RSI[^0-9]*/i, '').split(/[^\d.]/)[0] || ''}
                  <span className="text-[10px] text-muted-foreground/60 ml-0.5">
                    {rsiC.score >= 4 ? '⬆超卖' : rsiC.score <= -4 ? '⬇超买' : ''}
                  </span>
                </span>
              )}
              {macdC && (
                <span className={`text-[11px] font-medium ${macdC.score >= 5 ? 'text-red-500' : macdC.score <= -5 ? 'text-green-500' : 'text-muted-foreground'}`}>
                  MACD {macdC.detail.includes('金叉') ? '↑金叉' : macdC.detail.includes('死叉') ? '↓死叉' : macdC.detail.includes('上方') ? '↗偏多' : '↘偏空'}
                </span>
              )}
              {maC && (
                <span className={`text-[11px] font-medium ${maC.score >= 5 ? 'text-red-500' : maC.score <= -5 ? 'text-green-500' : 'text-muted-foreground'}`}>
                  MA {maC.detail.includes('多头') ? '↑多头' : maC.detail.includes('空头') ? '↓空头' : '↔交叉'}
                </span>
              )}
              {bollC && (
                <span className={`text-[11px] font-medium ${bollC.score >= 3 ? 'text-red-500' : bollC.score <= -3 ? 'text-green-500' : 'text-muted-foreground'}`}>
                  BOLL {bollC.detail.includes('收窄') ? '⟷变盘' : bollC.detail.includes('上轨') ? '⬇超买' : bollC.detail.includes('下轨') ? '⬆支撑' : '中性'}
                </span>
              )}
              {volC && (
                <span className={`text-[11px] font-medium ${volC.score >= 3 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  量 {volC.detail.includes('激增') ? '🔥异动' : volC.detail.includes('放大') ? '📈放量' : volC.detail.includes('萎缩') ? '📉缩量' : '正常'}
                </span>
              )}
            </div>
          )
        })()}

        {/* 调仓建议 */}
        <div className="mb-2 p-2 rounded bg-muted/15 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">操作建议：</span>
            <span className={`text-xs font-bold ${advice.color}`}>{advice.label}</span>
          </div>
          {advice.details.map((d, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">{d}</p>
          ))}
        </div>

        {/* 展开详情 */}
        <button onClick={() => setShowSignalDetail(!showSignalDetail)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <span className={`inline-block transition-transform ${showSignalDetail ? 'rotate-90' : ''}`}>▶</span>
          评分详情（权重可调）
        </button>
        {showSignalDetail && (
          <div className="mt-1.5 space-y-1">
            {signalResult.contributions.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-[10px] px-1.5 py-1 rounded bg-muted/20">
                <span className={`shrink-0 w-5 text-center font-mono text-[9px] font-bold ${c.score > 0 ? 'text-red-500' : c.score < 0 ? 'text-green-500' : 'text-muted-foreground'}`}>
                  {c.score > 0 ? '+' : ''}{c.score}
                </span>
                <span className="shrink-0 font-medium text-muted-foreground w-16">{c.label}</span>
                <span className="text-[9px] text-muted-foreground/60 shrink-0">×{c.weight}%</span>
                <span className="truncate text-muted-foreground/80 flex-1 min-w-0">{c.detail}</span>
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground/40 mt-0.5">
              评分范围 -100~+100 · 权重合计 {(Object.values(DEFAULT_WEIGHTS) as number[]).reduce((a, b) => a + b, 0)}% · 支持 AI 自动优化
            </p>
          </div>
        )}

        {/* 评分参考（可折叠） */}
        <div className="mt-2 pt-2 border-t">
          <button onClick={() => setShowRef(!showRef)}
            className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-foreground/80 transition-colors cursor-pointer w-full"
          >
            <span className={`inline-block transition-transform ${showRef ? 'rotate-90' : ''}`}>▶</span>
            调仓建议参考说明
          </button>
          {showRef && (
            <div className="mt-1.5 space-y-1.5 text-[9px] text-muted-foreground/70 leading-relaxed">
              <div className="p-1.5 rounded bg-muted/15">
                <p className="font-medium text-foreground/80 mb-0.5">📊 评分 × 指标组合建议</p>
                <div className="space-y-0.5">
                  {[
                    { cond: '高分 (>60) + RSI 超买 + BOLL 上轨', action: '⚠️ 趋势强但过热，观望/分批止盈' },
                    { cond: '高分 (>60) + RSI 中性', action: '✅ 多头强劲，可持有' },
                    { cond: '偏多 (20~60) + 超卖信号', action: '✅ 最佳补仓窗口' },
                    { cond: '偏空 (-60~-20) + 超卖信号', action: '👀 等待企稳' },
                    { cond: '强烈看空 (<-60)', action: '⛔ 减仓避险' },
                  ].map((r, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span className="text-muted-foreground/40">{r.cond}</span>
                      <span className="text-muted-foreground/60">→</span>
                      <span>{r.action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-1.5 rounded bg-muted/15">
                <p className="font-medium text-foreground/80 mb-0.5">🎯 得分原因对应操作</p>
                <div className="space-y-0.5">
                  {[
                    { reason: 'MA 多头排列 + MACD 金叉（趋势偏多）', action: '✅ 可以分批补仓' },
                    { reason: 'RSI 超卖 + 锤子线 + 布林带下轨（超跌反弹）', action: '✅ 左侧抄底，设好止损' },
                    { reason: 'RSI > 80 + 布林带上轨（过热）', action: '⚠️ 不补仓，甚至可减仓' },
                    { reason: '评分接近 0 + 量能萎缩（方向不明）', action: '❌ 观望等待' },
                  ].map((r, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span className="text-muted-foreground/40">{r.reason}</span>
                      <span className="text-muted-foreground/60">→</span>
                      <span>{r.action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[8px] text-muted-foreground/30 text-right">以上建议仅供参考，不构成投资建议</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
