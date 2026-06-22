import { useMemo } from 'react'
import type { KLineData } from '@/types'

interface Props {
  data: KLineData[]
  width?: number
  height?: number
}

const MARGIN = { top: 20, right: 16, bottom: 30, left: 56 }
const VOL_HEIGHT = 50

/** 蜡烛图组件 — 纯 SVG，显示 OHLC + 成交量柱 */
export default function CandlestickChart({ data, width = 480, height = 320 }: Props) {
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
