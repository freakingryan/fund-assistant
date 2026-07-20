/**
 * 每日方向性准确率趋势曲线
 * - 主指标：每日方向性准确率(%)（蓝紫线，左轴 0-100）
 * - 次指标：当日平均次日涨跌幅(%)，按涨红跌绿拆分为上行(红)/下行(绿)两条线（右轴）
 * 用于按日回看算法表现是否稳定、是否存在连续失效窗口。
 *
 * @module backtest/DailyAccuracyTrendChart
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import type { DailyAccuracyPoint } from '@/services/backtest/types'

const COLOR = {
  accuracy: '#8b5cf6', // 蓝紫：准确率
  up: '#ef4444',       // 涨红：次日平均上涨
  down: '#22c55e',     // 跌绿：次日平均下跌
}

export default function DailyAccuracyTrendChart({ daily }: { daily: DailyAccuracyPoint[] }) {
  const hasAccuracy = daily.some((d) => d.accuracy != null)
  const hasNext = daily.some((d) => d.avgNextChange != null)

  if (!hasAccuracy && !hasNext) {
    return (
      <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground">
        暂无方向性样本（需 buy/sell 建议且已回填次日涨跌）
      </div>
    )
  }

  const data = daily.map((d) => ({
    date: d.date.slice(5), // MM-DD
    accuracy: d.accuracy != null ? Number((d.accuracy * 100).toFixed(1)) : null,
    // 涨红跌绿：正涨拆到 up，负跌拆到 down
    up: d.avgNextChange != null && d.avgNextChange > 0 ? Number(d.avgNextChange.toFixed(2)) : null,
    down: d.avgNextChange != null && d.avgNextChange < 0 ? Number(d.avgNextChange.toFixed(2)) : null,
    sampleCount: d.sampleCount,
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 10, right: 8, bottom: 20, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis
          yAxisId="acc"
          domain={[0, 100]}
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => `${v}%`}
          width={36}
        />
        <YAxis
          yAxisId="next"
          orientation="right"
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => `${v}%`}
          width={36}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null
            const p = payload[0].payload as typeof data[number]
            return (
              <div className="rounded-md border bg-popover text-popover-foreground px-2 py-1.5 text-[10px] shadow-md">
                <p className="font-medium">{label}</p>
                {p.accuracy != null && <p>方向性准确率 <span className="font-mono">{p.accuracy}%</span></p>}
                {p.up != null && <p className="text-up">次日平均 <span className="font-mono">+{p.up}%</span></p>}
                {p.down != null && <p className="text-down">次日平均 <span className="font-mono">{p.down}%</span></p>}
                <p className="text-muted-foreground">样本 {p.sampleCount}</p>
              </div>
            )
          }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <ReferenceLine yAxisId="next" y={0} stroke="#9ca3af" strokeDasharray="4 4" />
        {hasAccuracy && (
          <Line
            yAxisId="acc"
            type="monotone"
            dataKey="accuracy"
            name="方向性准确率"
            stroke={COLOR.accuracy}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />
        )}
        {hasNext && (
          <Line yAxisId="next" type="monotone" dataKey="up" name="次日平均涨" stroke={COLOR.up} strokeWidth={1.5} dot={false} connectNulls />
        )}
        {hasNext && (
          <Line yAxisId="next" type="monotone" dataKey="down" name="次日平均跌" stroke={COLOR.down} strokeWidth={1.5} dot={false} connectNulls />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
