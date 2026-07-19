import { useState } from 'react'
import type { SignalResult } from '@/services/signalEngine'
import { DEFAULT_WEIGHTS } from '@/services/signalEngine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, CircleSlash } from 'lucide-react'

interface Props {
  signalResult: SignalResult | null
  showSignalDetail: boolean
  setShowSignalDetail: (v: boolean) => void
  /** 是否展示「场内 ETF 真实 K 线」；为 false 时评分为基于净值走势，置信度较低 */
  isRealKline?: boolean
}

/**
 * 分项评分明细 — 原为独立的「综合评分」卡，现已降级为
 * 「智能决策建议」的底层分项输入展示。最终结论以决策卡为准，
 * 此处不再展示头条总分（避免与决策卡 0-100 评分重复/冲突）。
 */
export default function SignalScoreCard({ signalResult, showSignalDetail, setShowSignalDetail, isRealKline = true }: Props) {
  const [showRef, setShowRef] = useState(false)
  if (!signalResult) return null

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />分项评分明细
          <span className="text-[10px] font-normal text-muted-foreground/60 ml-auto">决策引擎底层输入</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isRealKline && (
          <p className="text-[10px] text-muted-foreground/70 mb-2 flex items-center gap-1">
            <CircleSlash className="h-3 w-3 shrink-0" />
            基于基金净值走势（无成交量与 K 线形态信号，置信度较低）
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/70 mb-2 leading-relaxed">
          以下为综合评分引擎的 6 个分项信号，已作为底层输入融合进上方「智能决策建议」的最终结论。
        </p>

        {/* 关键指标一览（与决策结论保持一致的分项视角） */}
        {(() => {
          const rsiC = signalResult.contributions.find((c) => c.key === 'rsi')
          const macdC = signalResult.contributions.find((c) => c.key === 'macdCross')
          const maC = signalResult.contributions.find((c) => c.key === 'maTrend')
          const bollC = signalResult.contributions.find((c) => c.key === 'bollinger')
          const volC = signalResult.contributions.find((c) => c.key === 'volume')
          return (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
              {rsiC && (
                <span className={`text-[11px] font-medium ${rsiC.score >= 4 ? 'text-up' : rsiC.score <= -4 ? 'text-down' : 'text-muted-foreground'}`}>
                  RSI {rsiC.detail.replace(/^RSI[^0-9]*/i, '').split(/[^\d.]/)[0] || ''}
                  <span className="text-[10px] text-muted-foreground/60 ml-0.5">
                    {rsiC.score >= 4 ? '超卖' : rsiC.score <= -4 ? '超买' : ''}
                  </span>
                </span>
              )}
              {macdC && (
                <span className={`text-[11px] font-medium ${macdC.score >= 5 ? 'text-up' : macdC.score <= -5 ? 'text-down' : 'text-muted-foreground'}`}>
                  MACD {macdC.detail.includes('金叉') ? '↑金叉' : macdC.detail.includes('死叉') ? '↓死叉' : macdC.detail.includes('上方') ? '↗偏多' : '↘偏空'}
                </span>
              )}
              {maC && (
                <span className={`text-[11px] font-medium ${maC.score >= 5 ? 'text-up' : maC.score <= -5 ? 'text-down' : 'text-muted-foreground'}`}>
                  MA {maC.detail.includes('多头') ? '↑多头' : maC.detail.includes('空头') ? '↓空头' : '↔交叉'}
                </span>
              )}
              {bollC && (
                <span className={`text-[11px] font-medium ${bollC.score >= 3 ? 'text-up' : bollC.score <= -3 ? 'text-down' : 'text-muted-foreground'}`}>
                  BOLL {bollC.detail.includes('收窄') ? '⟷变盘' : bollC.detail.includes('上轨') ? '⬇超买' : bollC.detail.includes('下轨') ? '⬆支撑' : '中性'}
                </span>
              )}
              {volC && (
                <span className={`text-[11px] font-medium ${volC.score >= 3 ? 'text-up' : 'text-muted-foreground'}`}>
                  量 {volC.detail.includes('激增') ? '🔥异动' : volC.detail.includes('放大') ? '📈放量' : volC.detail.includes('萎缩') ? '📉缩量' : '正常'}
                </span>
              )}
            </div>
          )
        })()}

        {/* 展开：6 个分项贡献明细 */}
        <button onClick={() => setShowSignalDetail(!showSignalDetail)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <span className={`inline-block transition-transform ${showSignalDetail ? 'rotate-90' : ''}`}>▶</span>
          评分分项（权重可调）
        </button>
        {showSignalDetail && (
          <div className="mt-1.5 space-y-1">
            {signalResult.contributions.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-[10px] px-1.5 py-1 rounded bg-muted/20">
                <span className={`shrink-0 w-5 text-center font-mono text-[9px] font-bold ${c.score > 0 ? 'text-up' : c.score < 0 ? 'text-down' : 'text-muted-foreground'}`}>
                  {c.score > 0 ? '+' : ''}{c.score}
                </span>
                <span className="shrink-0 font-medium text-muted-foreground w-16">{c.label}</span>
                <span className="text-[9px] text-muted-foreground/60 shrink-0">×{c.weight}%</span>
                <span className="truncate text-muted-foreground/80 flex-1 min-w-0">{c.detail}</span>
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground/40 mt-0.5">
              旧引擎评分范围 -100~+100 · 权重合计 {(Object.values(DEFAULT_WEIGHTS) as number[]).reduce((a, b) => a + b, 0)}% · 已融合进决策引擎
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
