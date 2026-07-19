/**
 * 评分区间命中率柱状图
 * 横轴：评分区间（0-10, ..., 90-100）；纵轴：方向性命中率（%）。
 * 不显示 hitRate 为 null 的区间（无方向性样本）。
 *
 * @module backtest/AccuracyBucketChart
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import type { BucketStat } from '@/services/backtest/stats'

export default function AccuracyBucketChart({ buckets }: { buckets: BucketStat[] }) {
  const data = buckets
    .map((b) => ({
      bucket: b.bucket,
      hitRate: b.hitRate != null ? Math.round(b.hitRate * 100) : null,
      count: b.count,
      avgNext: b.avgNext,
    }))
    .filter((d) => d.hitRate != null)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground">
        暂无方向性样本（需 buy/sell 建议且已回填）
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 16, right: 12, bottom: 20, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} interval={0} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.1)' }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null
            const p = payload[0].payload as typeof data[number]
            return (
              <div className="rounded-md border bg-popover text-popover-foreground px-2 py-1.5 text-[10px] shadow-md">
                <p className="font-medium">评分 {p.bucket}</p>
                <p>命中率 <span className="font-mono">{p.hitRate}%</span></p>
                <p className="text-muted-foreground">方向性样本 {p.count} · 平均次日 {p.avgNext >= 0 ? '+' : ''}{p.avgNext.toFixed(2)}%</p>
              </div>
            )
          }}
        />
        <Bar dataKey="hitRate" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.hitRate != null && d.hitRate >= 50 ? '#ef4444' : '#22c55e'} />
          ))}
          <LabelList dataKey="hitRate" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 9, fill: 'currentColor' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
