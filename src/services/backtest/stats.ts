/**
 * 回测统计 — 纯函数，便于单测与图表复用
 *
 * @module backtest/stats
 */

import type { DailyAccuracyPoint, Recommendation, ScoreSnapshot } from './types'

export interface BucketStat {
  bucket: string
  /** 评分区间下界（含） */
  from: number
  /** 评分区间上界（不含） */
  to: number
  count: number
  /** 方向性命中率（correct / (correct+wrong)），无样本时为 null */
  hitRate: number | null
  /** 该区间样本平均次日涨跌幅 */
  avgNext: number
}

export interface BacktestStats {
  /** 全部快照数 */
  total: number
  /** 已回填（outcome 非 pending/unknown）的快照数 */
  settled: number
  byRec: Record<Recommendation, number>
  buyHits: number
  buyTotal: number
  buyHitRate: number | null
  sellHits: number
  sellTotal: number
  sellHitRate: number | null
  /** 方向性准确率：correct / (correct + wrong) */
  directionalCorrect: number
  directionalTotal: number
  directionalAccuracy: number | null
  /** 各建议的平均次日涨跌幅 */
  avgNextByRec: Record<Recommendation, number | null>
  /** 评分区间命中分布 */
  buckets: BucketStat[]
  /** 不同建议的已结算样本数 */
  settledByRec: Record<Recommendation, number>
}

const BUCKET_SIZE = 10

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/**
 * 计算回测统计汇总。
 * @param snapshots 全部快照
 */
export function computeBacktestStats(snapshots: ScoreSnapshot[]): BacktestStats {
  const settled = snapshots.filter((s) => s.outcome === 'correct' || s.outcome === 'wrong' || s.outcome === 'neutral')

  const byRec: Record<Recommendation, number> = { buy: 0, hold: 0, sell: 0 }
  const settledByRec: Record<Recommendation, number> = { buy: 0, hold: 0, sell: 0 }
  const avgNextAccum: Record<Recommendation, number[]> = { buy: [], hold: [], sell: [] }

  let buyHits = 0
  let buyTotal = 0
  let sellHits = 0
  let sellTotal = 0
  let directionalCorrect = 0
  let directionalTotal = 0

  for (const s of snapshots) {
    byRec[s.recommendation]++
    if (s.nextChangePct != null) avgNextAccum[s.recommendation].push(s.nextChangePct)

    if (s.outcome === 'correct' || s.outcome === 'wrong' || s.outcome === 'neutral') {
      settledByRec[s.recommendation]++
    }
    if (s.outcome === 'correct' || s.outcome === 'wrong') {
      if (s.recommendation !== 'hold') directionalTotal++
      if (s.outcome === 'correct') {
        directionalCorrect++
        if (s.recommendation === 'buy') buyHits++
        else if (s.recommendation === 'sell') sellHits++
      }
      if (s.recommendation === 'buy') buyTotal++
      else if (s.recommendation === 'sell') sellTotal++
    }
  }

  // 评分区间命中分布
  const bucketMap = new Map<number, { correct: number; wrong: number; next: number[] }>()
  for (let lo = 0; lo < 100; lo += BUCKET_SIZE) {
    bucketMap.set(lo, { correct: 0, wrong: 0, next: [] })
  }
  for (const s of snapshots) {
    if (s.outcome !== 'correct' && s.outcome !== 'wrong') continue
    const lo = Math.min(90, Math.floor(s.score / BUCKET_SIZE) * BUCKET_SIZE)
    const b = bucketMap.get(lo)!
    if (s.outcome === 'correct') b.correct++
    else b.wrong++
    if (s.nextChangePct != null) b.next.push(s.nextChangePct)
  }
  const buckets: BucketStat[] = []
  for (let lo = 0; lo < 100; lo += BUCKET_SIZE) {
    const b = bucketMap.get(lo)!
    const dirTotal = b.correct + b.wrong
    buckets.push({
      bucket: lo === 90 ? '90-100' : `${lo}-${lo + BUCKET_SIZE}`,
      from: lo,
      to: lo + BUCKET_SIZE,
      count: dirTotal,
      hitRate: dirTotal > 0 ? b.correct / dirTotal : null,
      avgNext: avg(b.next),
    })
  }

  return {
    total: snapshots.length,
    settled: settled.length,
    byRec,
    buyHits,
    buyTotal,
    buyHitRate: buyTotal > 0 ? buyHits / buyTotal : null,
    sellHits,
    sellTotal,
    sellHitRate: sellTotal > 0 ? sellHits / sellTotal : null,
    directionalCorrect,
    directionalTotal,
    directionalAccuracy: directionalTotal > 0 ? directionalCorrect / directionalTotal : null,
    avgNextByRec: {
      buy: avgNextAccum.buy.length ? avg(avgNextAccum.buy) : null,
      hold: avgNextAccum.hold.length ? avg(avgNextAccum.hold) : null,
      sell: avgNextAccum.sell.length ? avg(avgNextAccum.sell) : null,
    },
    buckets,
    settledByRec,
  }
}

const REC_LABEL: Record<Recommendation, string> = { buy: '买入', hold: '持有', sell: '卖出' }
export function recommendationLabel(rec: Recommendation): string {
  return REC_LABEL[rec]
}

const OUTCOME_LABEL: Record<ScoreSnapshot['outcome'], string> = {
  pending: '待回填',
  correct: '命中',
  wrong: '未命中',
  neutral: '中性',
  unknown: '未知',
}
export function outcomeLabel(o: ScoreSnapshot['outcome']): string {
  return OUTCOME_LABEL[o]
}

/**
 * 按快照日期聚合「每日方向性准确率」，用于按日回看趋势。
 * 仅纳入方向性样本（outcome 为 correct/wrong），中性/待回填不计。
 * @returns 按日期升序排列的数据点
 */
export function computeDailyAccuracySeries(snapshots: ScoreSnapshot[]): DailyAccuracyPoint[] {
  const byDate = new Map<string, { correct: number; wrong: number; next: number[] }>()
  for (const s of snapshots) {
    if (s.outcome !== 'correct' && s.outcome !== 'wrong') continue
    const b = byDate.get(s.date) || { correct: 0, wrong: 0, next: [] }
    if (s.outcome === 'correct') b.correct++
    else b.wrong++
    if (s.nextChangePct != null) b.next.push(s.nextChangePct)
    byDate.set(s.date, b)
  }
  const points: DailyAccuracyPoint[] = []
  for (const [date, b] of byDate) {
    const dirTotal = b.correct + b.wrong
    points.push({
      date,
      accuracy: dirTotal > 0 ? b.correct / dirTotal : null,
      sampleCount: dirTotal,
      avgNextChange: b.next.length ? avg(b.next) : null,
    })
  }
  points.sort((a, b) => (a.date < b.date ? -1 : 1))
  return points
}
