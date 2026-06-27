import { useMemo } from 'react'
import type { KLineData } from '@/types'
import type { DetectedPattern, KlinePattern } from '@/services/klinePatterns'
import { getPatternLabel } from '@/services/klinePatterns'

interface Props {
  data: KLineData[]
  width?: number
  height?: number
  patterns?: DetectedPattern[]
}

const MARGIN = { top: 24, right: 16, bottom: 30, left: 56 }
const VOL_HEIGHT = 50
const LABEL_OFFSET = 16

/** 形态标签样式映射 */
const PATTERN_STYLES: Partial<Record<KlinePattern, { bg: string; text: string; border: string }>> = {
  // 看涨形态 — 红色系
  hammer: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  bullish_marubozu: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  lower_shadow_yang: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  lower_shadow_yin: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  t_line: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  // 看跌形态 — 绿色系
  shooting_star: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  bearish_marubozu: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  upper_shadow_yin: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  inverted_t_line: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  // 中性形态 — 灰色系
  doji: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  long_legged_doji: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  upper_shadow_yang: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  small_yang: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  small_yin: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
}

/** 蜡烛图组件 — 纯 SVG，显示 OHLC + 成交量柱 + K 线形态标签 */
export default function CandlestickChart({ data, width = 480, height = 320, patterns = [] }: Props) {
  const chartWidth = width - MARGIN.left - MARGIN.right
  const chartHeight = height - MARGIN.top - MARGIN.bottom - VOL_HEIGHT - 8

  const { yScale, candles } = useMemo(() => {
    if (data.length === 0) return { yScale: { min: 0, max: 0 }, candles: [] }

    const high = Math.max(...data.map((d) => d.high))
    const low = Math.min(...data.map((d) => d.low))
    const pad = (high - low) * 0.05 || 0.01
    const yMin = low - pad
    const yMax = high + pad

    const stepX = chartWidth / Math.max(data.length - 1, 1)
    const candleWidth = Math.max(3, stepX * 0.6)
    const scaleY = (v: number) => chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight

    const candles = data.map((d, i) => {
      const cx = MARGIN.left + i * stepX
      const o = scaleY(d.open)
      const c = scaleY(d.close)
      const hi = scaleY(d.high)
      const lo = scaleY(d.low)
      const isUp = d.close >= d.open
      return { d, cx, o, c, hi, lo, isUp, candleWidth }
    })

    return { yScale: { min: yMin, max: yMax }, candles }
  }, [data, chartWidth, chartHeight])

  // Volume scale — in component scope so JSX can access it
  const maxVol = useMemo(() => Math.max(...data.map((d) => d.volume || 0), 1), [data])
  const scaleVol = (v: number) => (v / maxVol) * VOL_HEIGHT

  if (data.length === 0) return null

  // Y-axis ticks
  const ticks = (() => {
    const { min, max } = yScale
    const step = (max - min) / 5
    return Array.from({ length: 6 }, (_, i) => ({
      value: min + step * i,
      y: chartHeight - (step * i / (max - min)) * chartHeight + MARGIN.top,
    }))
  })()

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Y axis */}
      {ticks.map((t, i) => (
        <g key={i}>
          <text x={MARGIN.left - 6} y={t.y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {t.value.toFixed(t.value >= 100 ? 2 : 4)}
          </text>
          {i > 0 && (
            <line x1={MARGIN.left} y1={t.y} x2={MARGIN.left + chartWidth} y2={t.y}
              className="stroke-border/50" strokeWidth={0.5} />
          )}
        </g>
      ))}

      {/* Volume bars */}
      {candles.map((c, i) => (
        <rect
          key={`vol-${i}`}
          x={c.cx - c.candleWidth * 0.25}
          y={chartHeight + MARGIN.top + VOL_HEIGHT - scaleVol(c.d.volume || 0)}
          width={c.candleWidth * 0.5}
          height={scaleVol(c.d.volume || 0)}
          className={c.isUp ? 'fill-red-200/60' : 'fill-green-200/60'}
        />
      ))}

      {/* Candlesticks */}
      {candles.map((c, i) => {
        const bodyTop = Math.min(c.o, c.c)
        const bodyBottom = Math.max(c.o, c.c)
        const label = patterns.length > 0 ? getPatternLabel(patterns, i) : null
        const style = label ? PATTERN_STYLES[label as KlinePattern] : null
        return (
          <g key={`c-${i}`}>
            <line x1={c.cx} y1={c.hi} x2={c.cx} y2={c.lo}
              className={c.isUp ? 'stroke-red-500' : 'stroke-green-500'} strokeWidth={1} />
            <rect
              x={c.cx - c.candleWidth / 2}
              y={bodyTop}
              width={c.candleWidth}
              height={Math.max(bodyBottom - bodyTop, 1)}
              className={c.isUp ? 'fill-red-500' : 'fill-green-500'}
            />
            {label && style && (
              <g>
                <rect
                  x={c.cx - 14}
                  y={Math.max(c.hi - LABEL_OFFSET, 4)}
                  width={28}
                  height={14}
                  rx={3}
                  fill={style.bg}
                  stroke={style.border}
                  strokeWidth={0.5}
                />
                <text
                  x={c.cx}
                  y={Math.max(c.hi - LABEL_OFFSET + 10, 14)}
                  textAnchor="middle"
                  fill={style.text}
                  fontSize={9}
                  fontWeight={500}
                >
                  {label}
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* X-axis labels (last 5 dates) */}
      {(() => {
        const n = data.length
        const indices = n <= 5 ? Array.from({ length: n }, (_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1]
        return indices.map((i) => (
          <text
            key={`x-${i}`}
            x={MARGIN.left + i * (chartWidth / Math.max(n - 1, 1))}
            y={height - 4}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {data[i]?.date?.slice(5) || ''}
          </text>
        ))
      })()}
    </svg>
  )
}
