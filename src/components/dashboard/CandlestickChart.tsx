import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import type { KLineData } from '@/types'
import type { DetectedPattern, KlinePattern } from '@/services/klinePatterns'
import { getPatternLabel } from '@/services/klinePatterns'

interface Props {
  data: KLineData[]
  width?: number
  height?: number
  patterns?: DetectedPattern[]
}

interface TooltipData {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  pattern: string | null
  cx: number
  side: 'left' | 'right' | 'center'
}

const MARGIN = { top: 24, right: 16, bottom: 30, left: 56 }
const VOL_HEIGHT = 50
const LABEL_OFFSET = 16
const TOOLTIP_W = 160
const TOOLTIP_H = 105
const HIT_MARGIN = 8

const PATTERN_STYLES: Partial<Record<KlinePattern, { bg: string; text: string; border: string }>> = {
  hammer: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  bullish_marubozu: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  lower_shadow_yang: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  lower_shadow_yin: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  t_line: { bg: 'rgba(239,68,68,0.12)', text: '#dc2626', border: '#fca5a5' },
  shooting_star: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  bearish_marubozu: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  upper_shadow_yin: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  inverted_t_line: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', border: '#86efac' },
  doji: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  long_legged_doji: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  upper_shadow_yang: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  small_yang: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
  small_yin: { bg: 'rgba(156,163,175,0.12)', text: '#6b7280', border: '#d1d5db' },
}

/** 计算 Tooltip 横向偏移，确保不超出左右边界且不遮挡当前 K 线 */
function tooltipLeft(cx: number, side: 'left' | 'right' | 'center', chartRight: number): number {
  if (side === 'right') return Math.min(cx + 12, chartRight - TOOLTIP_W)
  if (side === 'left') return Math.max(cx - TOOLTIP_W - 12, MARGIN.left)
  // center — clamp to viewport
  return Math.max(MARGIN.left, Math.min(cx - TOOLTIP_W / 2, chartRight - TOOLTIP_W))
}

/** 蜡烛图组件 — SVG 内嵌 + 浮动 Tooltip（防遮挡 + 触屏支持） */
export default function CandlestickChart({ data, width = 480, height = 320, patterns = [] }: Props) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭 tooltip（触屏 & 桌面通用）
  useEffect(() => {
    if (!tooltip) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTooltip(null)
        setSelectedIndex(null)
      }
    }
    // delay to avoid closing on the same tap that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [tooltip])

  const chartWidth = width - MARGIN.left - MARGIN.right
  const chartHeight = height - MARGIN.top - MARGIN.bottom - VOL_HEIGHT - 8
  const chartRight = MARGIN.left + chartWidth

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

  const maxVol = useMemo(() => Math.max(...data.map((d) => d.volume || 0), 1), [data])
  const scaleVol = (v: number) => (v / maxVol) * VOL_HEIGHT

  /** 计算 K 线文案 + 锚定方向 */
  const buildTooltip = useCallback((i: number): TooltipData => {
    const d = data[i]
    const pattern = getPatternLabel(patterns, i)
    const cx = candles[i]?.cx ?? MARGIN.left
    // 左侧 → 向右锚定；右侧 → 向左锚定；中间 → 居中
    const side: 'left' | 'right' | 'center' =
      cx < MARGIN.left + 90 ? 'right'
      : cx > chartRight - 90 ? 'left'
      : 'center'
    return { date: d.date, open: d.open, close: d.close, high: d.high, low: d.low, volume: d.volume || 0, pattern, cx, side }
  }, [data, patterns, candles, chartRight])

  const showTooltip = useCallback((i: number) => {
    setTooltip(buildTooltip(i))
    setSelectedIndex(i)
  }, [buildTooltip])

  const hideTooltip = useCallback(() => {
    setTooltip(null)
    setSelectedIndex(null)
  }, [])

  const toggleTooltip = useCallback((i: number) => {
    if (selectedIndex === i) {
      hideTooltip()
    } else {
      showTooltip(i)
    }
  }, [selectedIndex, showTooltip, hideTooltip])

  if (data.length === 0) return null

  const ticks = (() => {
    const { min, max } = yScale
    const step = (max - min) / 5
    return Array.from({ length: 6 }, (_, i) => ({
      value: min + step * i,
      y: chartHeight - (step * i / (max - min)) * chartHeight + MARGIN.top,
    }))
  })()

  const fmt = (v: number) => v.toFixed(v >= 100 ? 2 : 4)

  return (
    <div ref={containerRef} className="relative inline-block select-none" style={{ width, height, touchAction: 'manipulation' }}>
      <svg width={width} height={height} className="overflow-visible">
        {/* Y axis */}
        {ticks.map((t, i) => (
          <g key={i}>
            <text x={MARGIN.left - 6} y={t.y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {fmt(t.value)}
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
            pointerEvents="none"
          />
        ))}

        {/* Candlesticks */}
        {candles.map((c, i) => {
          const bodyTop = Math.min(c.o, c.c)
          const bodyBottom = Math.max(c.o, c.c)
          const label = patterns.length > 0 ? getPatternLabel(patterns, i) : null
          const style = label ? PATTERN_STYLES[label as KlinePattern] : null
          const isSelected = selectedIndex === i
          const hitW = Math.max(c.candleWidth, 12) * 2
          return (
            <g key={`c-${i}`}>
              {/* Wider invisible hit area: desktop hover + touch click */}
              <rect
                x={c.cx - hitW / 2}
                y={0}
                width={hitW}
                height={chartHeight + VOL_HEIGHT}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => showTooltip(i)}
                onMouseLeave={hideTooltip}
                onClick={() => toggleTooltip(i)}
                onTouchEnd={(e) => { e.preventDefault(); toggleTooltip(i) }}
              />
              <line x1={c.cx} y1={c.hi} x2={c.cx} y2={c.lo}
                className={c.isUp ? 'stroke-red-500' : 'stroke-green-500'} strokeWidth={isSelected ? 2 : 1} />
              <rect
                x={c.cx - c.candleWidth / 2}
                y={bodyTop}
                width={c.candleWidth}
                height={Math.max(bodyBottom - bodyTop, 1)}
                className={c.isUp ? 'fill-red-500' : 'fill-green-500'}
                stroke={isSelected ? (c.isUp ? '#991b1b' : '#166534') : 'none'}
                strokeWidth={isSelected ? 1 : 0}
                pointerEvents="none"
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
                    stroke={isSelected ? style.text : style.border}
                    strokeWidth={isSelected ? 1 : 0.5}
                    pointerEvents="none"
                  />
                  <text
                    x={c.cx}
                    y={Math.max(c.hi - LABEL_OFFSET + 10, 14)}
                    textAnchor="middle"
                    fill={style.text}
                    fontSize={9}
                    fontWeight={500}
                    pointerEvents="none"
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

      {/* 浮动 Tooltip — 固定于 K 线上方，不遮挡蜡烛 */}
      {tooltip && (() => {
        const lx = tooltipLeft(tooltip.cx, tooltip.side, chartRight)
        return (
          <div
            className="absolute z-50 bg-white border rounded-md shadow-md px-2.5 py-1.5 text-xs leading-relaxed"
            style={{ left: lx, top: Math.max(MARGIN.top - TOOLTIP_H - 4, 2) }}
          >
            {/* 关闭按钮（触屏友好） */}
            <button
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground flex items-center justify-center text-[9px] leading-none hover:bg-muted-foreground/40 transition-colors cursor-pointer pointer-events-auto"
              onClick={hideTooltip}
              onTouchEnd={(e) => { e.stopPropagation(); hideTooltip() }}
            >
              ×
            </button>
            <div className="font-medium text-[11px] mb-0.5 pr-2">{tooltip.date}</div>
            <div className="text-muted-foreground space-y-0.5">
              <div className="flex gap-3">
                <span>开 <span className="text-foreground font-medium">{fmt(tooltip.open)}</span></span>
                <span>收 <span className={`font-medium ${tooltip.close >= tooltip.open ? 'text-red-500' : 'text-green-500'}`}>{fmt(tooltip.close)}</span></span>
              </div>
              <div className="flex gap-3">
                <span>高 <span className="text-foreground font-medium">{fmt(tooltip.high)}</span></span>
                <span>低 <span className="text-foreground font-medium">{fmt(tooltip.low)}</span></span>
              </div>
              <div>量 <span className="text-foreground font-medium">{tooltip.volume.toLocaleString()}</span></div>
              {tooltip.pattern && (
                <div className="mt-0.5 pt-0.5 border-t">
                  <span className={tooltip.close >= tooltip.open ? 'text-red-500 font-medium' : 'text-green-500 font-medium'}>{tooltip.pattern}</span>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
