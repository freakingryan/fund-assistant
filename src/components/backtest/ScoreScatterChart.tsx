/**
 * 评分 vs 次日涨跌幅 散点图（按回测结果着色）
 * 涨红跌绿：命中(correct)=红、未命中(wrong)=绿、中性(neutral)=灰
 *
 * @module backtest/ScoreScatterChart
 */

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis, Cell } from 'recharts'
import type { ScoreSnapshot } from '@/services/backtest/types'

const COLOR = {
  correct: '#ef4444', // 涨红（命中）
  wrong: '#22c55e',   // 跌绿（未命中）
  neutral: '#9ca3af', // 灰（中性）
}

export default function ScoreScatterChart({ snapshots }: { snapshots: ScoreSnapshot[] }) {
  const data = snapshots
    .filter((s) => s.nextChangePct != null && (s.outcome === 'correct' || s.outcome === 'wrong' || s.outcome === 'neutral'))
    .map((s) => ({
      score: s.score,
      next: s.nextChangePct as number,
      outcome: s.outcome,
      fund: `${s.fundName}(${s.fundCode})`,
      date: s.date,
      rec: s.recommendation,
    }))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground">
        暂无已回填数据（需先记录评分并在次日回填涨跌）
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
        <XAxis
          type="number" dataKey="score" name="评分" domain={[0, 100]}
          tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}`}
          label={{ value: '综合评分', position: 'insideBottom', offset: -10, fontSize: 10 }}
        />
        <YAxis
          type="number" dataKey="next" name="次日涨跌幅" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`}
          label={{ value: '次日涨跌%', angle: -90, position: 'insideLeft', fontSize: 10 }}
        />
        <ZAxis range={[40, 40]} />
        <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null
            const p = payload[0].payload as typeof data[number]
            return (
              <div className="rounded-md border bg-popover text-popover-foreground px-2 py-1.5 text-[10px] shadow-md">
                <p className="font-medium">{p.fund}</p>
                <p className="text-muted-foreground">{p.date} · 建议 {p.rec}</p>
                <p>评分 <span className="font-mono">{p.score}</span> · 次日 <span className={`font-mono ${p.next >= 0 ? 'text-up' : 'text-down'}`}>{p.next >= 0 ? '+' : ''}{p.next.toFixed(2)}%</span></p>
                <p className="text-muted-foreground">结果：{p.outcome === 'correct' ? '命中' : p.outcome === 'wrong' ? '未命中' : '中性'}</p>
              </div>
            )
          }}
        />
        <Scatter data={data} fillOpacity={0.75}>
          {data.map((d, i) => (
            <Cell key={i} fill={COLOR[d.outcome as keyof typeof COLOR] || COLOR.neutral} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  )
}
