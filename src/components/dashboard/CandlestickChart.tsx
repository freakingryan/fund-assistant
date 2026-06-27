import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import type { KLineData } from '@/types'
import type { DetectedPattern, KlinePattern } from '@/services/klinePatterns'
import { getPatternLabel } from '@/services/klinePatterns'
import { calculateAll, type TechnicalIndicators } from '@/services/technicalIndicators'

interface Props {
  data: KLineData[]
  width?: number
  height?: number
  patterns?: DetectedPattern[]
  /** 外部联动：鼠标悬停时通知父组件当前 K 线索引 (hoverIndex, 无悬停时为 null) */
  onHover?: (index: number | null) => void
  /** 显示 MA5/MA10/MA20/MA60 均线 */
  showMA?: boolean
  /** 显示布林带 (Bollinger Bands) */
  showBollinger?: boolean
  /** 预计算的技术指标（如果传入则使用，否则内部自动计算） */
  technicals?: TechnicalIndicators
}

const MARGIN = { top: 24, right: 16, bottom: 30, left: 56 }
const VOL_HEIGHT = 50
const LABEL_OFFSET = 16
const INFO_BAR_H = 42

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

/** 蜡烛图组件 — SVG 内嵌 + 底部信息栏（不遮挡图表 + 深色模式适配 + 触屏支持 + 技术指标叠加） */
export default function CandlestickChart({
  data, width = 480, height = 320, patterns = [], onHover,
  showMA = false, showBollinger = false, technicals: externalTechnicals,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部取消选中（触屏 & 桌面通用）
  useEffect(() => {
    if (selectedIndex === null) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedIndex(null)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [selectedIndex])

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

  const maxVol = useMemo(() => Math.max(...data.map((d) => d.volume || 0), 1), [data])
  const scaleVol = (v: number) => (v / maxVol) * VOL_HEIGHT

  const selected = selectedIndex !== null ? data[selectedIndex] : null
  const selectedCandle = selectedIndex !== null ? candles[selectedIndex] : null
  const selectedPattern = selectedIndex !== null ? getPatternLabel(patterns, selectedIndex) : null

  const toggleSelect = useCallback((i: number) => {
    setSelectedIndex((prev) => (prev === i ? null : i))
  }, [])

  // 技术指标计算（外部传入优先，否则内部自动计算）
  const technicals = useMemo(() => {
    if (externalTechnicals) return externalTechnicals
    if (!showMA && !showBollinger) return null
    return calculateAll(data)
  }, [data, showMA, showBollinger, externalTechnicals])

  // 均线颜色
  const MA_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#14b8a6'] as const
  const MA_LABELS = ['MA5', 'MA10', 'MA20', 'MA60'] as const

  // 将均线数值转为 SVG polyline points
  const buildMAPolyline = (values: (number | null)[], stepX: number): string | null => {
    const pts: string[] = []
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue
      const x = MARGIN.left + i * stepX
      const y = chartHeight - ((values[i]! - yScale.min) / (yScale.max - yScale.min)) * chartHeight + MARGIN.top
      pts.push(`${x},${y}`)
    }
    return pts.length > 1 ? pts.join(' ') : null
  }

  const buildBollingerPolyline = (values: (number | null)[], stepX: number): string | null => {
    const pts: string[] = []
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue
      const x = MARGIN.left + i * stepX
      const y = chartHeight - ((values[i]! - yScale.min) / (yScale.max - yScale.min)) * chartHeight + MARGIN.top
      pts.push(`${x},${y}`)
    }
    return pts.length > 1 ? pts.join(' ') : null
  }

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
    <div ref={containerRef} className="relative inline-block" style={{ touchAction: 'manipulation' }}>
      {/* SVG 图表（tooltip 置于外部，绝不遮挡） */}
      <div style={{ width }}>
        <svg width={width} height={height} className="overflow-visible select-none">
          {/* Y axis */}
          {ticks.map((t, i) => (
            <g key={i}>
              <text x={MARGIN.left - 6} y={t.y + 4} textAnchor="end" className="fill-muted-foreground text-[10px] dark:fill-muted-foreground">
                {fmt(t.value)}
              </text>
              {i > 0 && (
                <line x1={MARGIN.left} y1={t.y} x2={MARGIN.left + chartWidth} y2={t.y}
                  className="stroke-border/50 dark:stroke-border/30" strokeWidth={0.5} />
              )}
            </g>
          ))}

          {/* 技术指标图例 */}
          {(showMA || showBollinger) && (
            <g>
              {/* 图例背景 */}
              <rect x={MARGIN.left + 4} y={MARGIN.top + 2} width={108} height={showMA && showBollinger ? 42 : showMA ? 44 : 18}
                rx={3} fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.08)" strokeWidth={0.5} />

              {/* Bollinger Bands fill */}
              {showBollinger && technicals && (() => {
                const stepX = chartWidth / Math.max(data.length - 1, 1)
                const upperPts = buildBollingerPolyline(technicals.bollinger.upper, stepX)
                const lowerPts = buildBollingerPolyline(technicals.bollinger.lower, stepX)
                if (!upperPts || !lowerPts) return null
                // 需要反转 lower 的 points 以形成闭合路径
                const lowerArr = technicals.bollinger.lower
                let lowerRev = ''
                for (let i = lowerArr.length - 1; i >= 0; i--) {
                  if (lowerArr[i] === null) continue
                  const x = MARGIN.left + i * stepX
                  const y = chartHeight - ((lowerArr[i]! - yScale.min) / (yScale.max - yScale.min)) * chartHeight + MARGIN.top
                  lowerRev += `${x},${y} `
                }
                if (!lowerRev.trim()) return null
                return (
                  <path
                    d={`M ${upperPts} L ${lowerRev.trim()} Z`}
                    fill="rgba(59,130,246,0.06)"
                    stroke="none"
                    pointerEvents="none"
                  />
                )
              })()}

              {/* Bollinger Legend */}
              {showBollinger && (
                <g>
                  <line x1={MARGIN.left + 8} y1={MARGIN.top + 12} x2={MARGIN.left + 20} y2={MARGIN.top + 12}
                    stroke="#93c5fd" strokeWidth={0.5} strokeDasharray="4,3" />
                  <line x1={MARGIN.left + 8} y1={MARGIN.top + 18} x2={MARGIN.left + 20} y2={MARGIN.top + 18}
                    stroke="#3b82f6" strokeWidth={1} />
                  <text x={MARGIN.left + 24} y={MARGIN.top + 16} fontSize={9} fill="#6b7280" dominantBaseline="middle">BOLL</text>
                  {showMA && (
                    <text x={MARGIN.left + 52} y={MARGIN.top + 16} fontSize={9} fill="#6b7280" dominantBaseline="middle">(20,2)</text>
                  )}
                </g>
              )}

              {/* MA 图例项 */}
              {showMA && (
                <g>
                  {[0, 1, 2, 3].map((mi) => {
                    const y = (showBollinger ? MARGIN.top + 24 : MARGIN.top + 6) + mi * 10
                    // 只显示有数据的均线
                    const maArr = [technicals?.ma.ma5, technicals?.ma.ma10, technicals?.ma.ma20, technicals?.ma.ma60][mi]
                    const hasData = maArr?.some((v) => v !== null)
                    if (!hasData) return null
                    return (
                      <g key={`ma-legend-${mi}`}>
                        <line x1={MARGIN.left + 8} y1={y} x2={MARGIN.left + 20} y2={y}
                          stroke={MA_COLORS[mi]} strokeWidth={1.5} />
                        <text x={MARGIN.left + 24} y={y} fontSize={9} fill={MA_COLORS[mi]} dominantBaseline="middle" fontWeight={500}>
                          {MA_LABELS[mi]}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )}

              {/* Bollinger Lines */}
              {showBollinger && technicals && ['upper', 'middle', 'lower'].map((band) => {
                const values = technicals!.bollinger[band as keyof typeof technicals.bollinger]
                const stepX = chartWidth / Math.max(data.length - 1, 1)
                const pts = buildBollingerPolyline(values as (number | null)[], stepX)
                if (!pts) return null
                return (
                  <polyline
                    key={`bb-${band}`}
                    points={pts}
                    fill="none"
                    stroke={band === 'middle' ? '#3b82f6' : '#93c5fd'}
                    strokeWidth={band === 'middle' ? 1 : 0.5}
                    strokeDasharray={band === 'middle' ? 'none' : '4,3'}
                    pointerEvents="none"
                  />
                )
              })}

              {/* MA Lines */}
              {showMA && technicals && [
                technicals.ma.ma5,
                technicals.ma.ma10,
                technicals.ma.ma20,
                technicals.ma.ma60,
              ].map((maArr, mi) => {
                if (!maArr) return null
                const stepX = chartWidth / Math.max(data.length - 1, 1)
                const pts = buildMAPolyline(maArr, stepX)
                if (!pts) return null
                return (
                  <polyline
                    key={`ma-${mi}`}
                    points={pts}
                    fill="none"
                    stroke={MA_COLORS[mi]}
                    strokeWidth={1.2}
                    pointerEvents="none"
                  />
                )
              })}
            </g>
          )}

          {/* Volume bars */}
          {candles.map((c, i) => (
            <rect
              key={`vol-${i}`}
              x={c.cx - c.candleWidth * 0.25}
              y={chartHeight + MARGIN.top + VOL_HEIGHT - scaleVol(c.d.volume || 0)}
              width={c.candleWidth * 0.5}
              height={scaleVol(c.d.volume || 0)}
              className={c.isUp ? 'fill-red-200/60 dark:fill-red-900/40' : 'fill-green-200/60 dark:fill-green-900/40'}
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
                {/* Wider invisible hit area */}
                <rect
                  x={c.cx - hitW / 2}
                  y={0}
                  width={hitW}
                  height={chartHeight + VOL_HEIGHT}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => { setSelectedIndex(i); onHover?.(i) }}
                  onMouseLeave={() => { setSelectedIndex(null); onHover?.(null) }}
                  onClick={() => toggleSelect(i)}
                  onTouchEnd={(e) => { e.preventDefault(); toggleSelect(i) }}
                />
                <line x1={c.cx} y1={c.hi} x2={c.cx} y2={c.lo}
                  className={c.isUp ? 'stroke-red-500 dark:stroke-red-400' : 'stroke-green-500 dark:stroke-green-400'}
                  strokeWidth={isSelected ? 2 : 1} />
                <rect
                  x={c.cx - c.candleWidth / 2}
                  y={bodyTop}
                  width={c.candleWidth}
                  height={Math.max(bodyBottom - bodyTop, 1)}
                  className={c.isUp ? 'fill-red-500 dark:fill-red-400' : 'fill-green-500 dark:fill-green-400'}
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
                className="fill-muted-foreground text-[10px] dark:fill-muted-foreground"
              >
                {data[i]?.date?.slice(5) || ''}
              </text>
            ))
          })()}
        </svg>
      </div>

      {/* 底部信息栏 — 固定高度容器，防止显示/隐藏时布局移动 */}
      <div style={{ marginTop: 4, height: INFO_BAR_H }}>
        {selected !== null && selectedCandle !== null ? (
          <div className="flex items-center gap-2 md:gap-4 px-3 py-1.5 bg-card border rounded-md text-xs w-full overflow-x-auto h-full">
            <span className="shrink-0 font-medium text-foreground">{selected.date}</span>
            <span className="shrink-0 flex items-center gap-1">
              <span className="text-muted-foreground">开</span>
              <span className="font-medium text-foreground">{fmt(selected.open)}</span>
            </span>
            <span className="shrink-0 flex items-center gap-1">
              <span className="text-muted-foreground">收</span>
              <span className={`font-medium ${selected.close >= selected.open ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}>
                {fmt(selected.close)}
              </span>
            </span>
            <span className="shrink-0 flex items-center gap-1">
              <span className="text-muted-foreground">高</span>
              <span className="font-medium text-foreground">{fmt(selected.high)}</span>
            </span>
            <span className="shrink-0 flex items-center gap-1">
              <span className="text-muted-foreground">低</span>
              <span className="font-medium text-foreground">{fmt(selected.low)}</span>
            </span>
            <span className="shrink-0 flex items-center gap-1">
              <span className="text-muted-foreground">量</span>
              <span className="font-medium text-foreground">{(selected.volume || 0).toLocaleString()}</span>
            </span>
            {selectedPattern && (
              <span className={`shrink-0 font-medium px-1.5 py-0.5 rounded text-[11px] ${
                selected.close >= selected.open
                  ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                  : 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400'
              }`}>
                {selectedPattern}
              </span>
            )}
          </div>
        ) : (
          /* 占位符：保持固定高度，防止布局抖动 */
          <div className="flex items-center px-3 py-1.5 text-xs w-full h-full">
            <span className="text-muted-foreground/40 text-[10px]">悬停或点击 K 线查看详情</span>
          </div>
        )}
      </div>
    </div>
  )
}
