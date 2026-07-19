import { useMemo } from 'react'
import type { KLineData } from '@/types'
import { computeStockSdkIndicators, type IndicatorSnapshot } from '@/services/stockSdkIndicators'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity, Info } from 'lucide-react'

type Tone = 'up' | 'down' | 'neutral'

interface Props {
  klines: KLineData[]
}

/** 取多周期指标记录的第一项值（用于 BIAS/WR 等） */
function firstValue(rec?: Record<string, number | null>): { period: string; value: number | null } | null {
  if (!rec) return null
  const keys = Object.keys(rec)
  if (keys.length === 0) return null
  const period = keys[0]
  return { period, value: rec[period] }
}

function toneClass(tone: Tone): string {
  if (tone === 'up') return 'text-up'
  if (tone === 'down') return 'text-down'
  return 'text-foreground'
}

function Stat({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 transition-colors hover:border-border hover:bg-muted/50">
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${toneClass(tone)}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground leading-tight">{sub}</div>}
    </div>
  )
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

export function TechnicalIndicatorsPanel({ klines }: Props) {
  const result = useMemo(() => computeStockSdkIndicators(klines), [klines])
  const { ohlcAvailable, latest, signals } = result

  if (klines.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />技术指标
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">暂无 K 线数据</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />技术指标
          <span className="text-[10px] font-normal text-muted-foreground">stock-sdk · 本地计算</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ohlcAvailable && (
          <div className="flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>当前为基金净值走势（无盘中区间），仅显示 BIAS/ROC；切换「场内 ETF 真实 K 线」可查看 KDJ/WR/CCI/ATR/DMI/SAR/KC 等完整指标。</span>
          </div>
        )}

        {/* 指标最新值网格 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <KdjStat snap={latest} />
          <WrStat snap={latest} />
          <CciStat snap={latest} />
          <BiasStat snap={latest} />
          <AtrStat snap={latest} />
          <DmiStat snap={latest} />
          <SarStat snap={latest} />
          <KcStat snap={latest} />
          <RocStat snap={latest} />
        </div>

        {/* 事件信号列表 */}
        {signals.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">技术信号事件</div>
            <ul className="space-y-1">
              {signals.map((s, i) => (
                <li key={`${s.type}-${s.date}-${i}`} className="flex items-center gap-2 text-xs rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.direction === 'up' ? 'bg-up' : 'bg-down'}`} />
                  <span className={`font-medium ${s.direction === 'up' ? 'text-up' : 'text-down'}`}>{s.label}</span>
                  <span className="text-muted-foreground tabular-nums ml-auto">{s.date.slice(5)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 各指标卡片 ───────────────────────────────────

function KdjStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.kdj) return null
  const { k, d, j } = snap.kdj
  const tone: Tone = j == null ? 'neutral' : j > 80 ? 'down' : j < 20 ? 'up' : 'neutral'
  return <Stat label="KDJ (K/D/J)" value={`${fmt(k)} / ${fmt(d)} / ${fmt(j)}`} sub="J>80 超买 · J<20 超卖" tone={tone} />
}

function WrStat({ snap }: { snap: IndicatorSnapshot }) {
  const f = firstValue(snap.wr)
  if (!f) return null
  const tone: Tone = f.value == null ? 'neutral' : f.value < 20 ? 'down' : f.value > 80 ? 'up' : 'neutral'
  return <Stat label={`WR(${f.period})`} value={fmt(f.value)} sub="<20 超买 · >80 超卖" tone={tone} />
}

function CciStat({ snap }: { snap: IndicatorSnapshot }) {
  if (snap.cci == null) return null
  const tone: Tone = snap.cci > 100 ? 'down' : snap.cci < -100 ? 'up' : 'neutral'
  return <Stat label="CCI" value={fmt(snap.cci)} sub=">100 超买 · <-100 超卖" tone={tone} />
}

function BiasStat({ snap }: { snap: IndicatorSnapshot }) {
  const f = firstValue(snap.bias)
  if (!f) return null
  const tone: Tone = f.value == null ? 'neutral' : f.value > 5 ? 'down' : f.value < -5 ? 'up' : 'neutral'
  return <Stat label={`BIAS(${f.period})`} value={fmt(f.value)} sub="乖离率 %" tone={tone} />
}

function AtrStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.atr) return null
  return <Stat label="ATR" value={fmt(snap.atr.atr)} sub="平均真实波幅" />
}

function DmiStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.dmi) return null
  const { pdi, mdi, adx } = snap.dmi
  const tone: Tone = pdi == null || mdi == null ? 'neutral' : pdi > mdi ? 'up' : 'down'
  return <Stat label="DMI (+DI/-DI/ADX)" value={`${fmt(pdi)} / ${fmt(mdi)} / ${fmt(adx)}`} sub="ADX>25 趋势强" tone={tone} />
}

function SarStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.sar) return null
  const tone: Tone = snap.sar.trend === 1 ? 'up' : snap.sar.trend === -1 ? 'down' : 'neutral'
  const label = snap.sar.trend === 1 ? '上升趋势' : snap.sar.trend === -1 ? '下降趋势' : '盘整'
  return <Stat label="SAR" value={fmt(snap.sar.sar)} sub={label} tone={tone} />
}

function KcStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.kc) return null
  return <Stat label="KC 通道宽" value={fmt(snap.kc.width)} sub="肯特纳通道" />
}

function RocStat({ snap }: { snap: IndicatorSnapshot }) {
  if (!snap.roc) return null
  const tone: Tone = snap.roc.roc == null ? 'neutral' : snap.roc.roc > 0 ? 'up' : 'down'
  return <Stat label="ROC" value={`${fmt(snap.roc.roc)}%`} sub="变动率" tone={tone} />
}
