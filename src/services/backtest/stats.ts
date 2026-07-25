/**
 * 回测统计 — 纯函数，便于单测与图表复用
 *
 * @module backtest/stats
 */

import type { DailyAccuracyPoint, Recommendation, ScoreSnapshot, ValueSource } from "./types";

export interface BucketStat {
  bucket: string;
  /** 评分区间下界（含） */
  from: number;
  /** 评分区间上界（不含） */
  to: number;
  /** 方向性样本数（correct + wrong），构成命中率分母 */
  count: number;
  /** 该区间全部已结算样本数（含 neutral/hold），用于暴露「高分全为持有」测量盲区 */
  settledCount: number;
  /** 方向性命中率（correct / (correct+wrong)），无方向性样本时为 null */
  hitRate: number | null;
  /** 该区间样本平均次日涨跌幅（含 neutral，已剔除超额极值） */
  avgNext: number;
}

export interface BacktestStats {
  /** 全部快照数 */
  total: number;
  /** 已回填（outcome 非 pending/unknown）的快照数 */
  settled: number;
  byRec: Record<Recommendation, number>;
  buyHits: number;
  buyTotal: number;
  buyHitRate: number | null;
  sellHits: number;
  sellTotal: number;
  sellHitRate: number | null;
  /** 方向性准确率：correct / (correct + wrong) */
  directionalCorrect: number;
  directionalTotal: number;
  directionalAccuracy: number | null;
  /**
   * 方向性覆盖率：方向性样本(有买/卖押注)占已结算样本的比例。
   * 偏低说明大量快照为持有建议(neutral)，其高分区间无法进入方向性命中率统计——
   * 这是「样本出现 60-74 分但 60-70 区间 count=0」这类「分桶矛盾」的根因，非数据损坏。
   */
  directionalCoverage: number | null;
  /** 各建议的平均次日涨跌幅 */
  avgNextByRec: Record<Recommendation, number | null>;
  /** 评分区间命中分布 */
  buckets: BucketStat[];
  /** 不同建议的已结算样本数 */
  settledByRec: Record<Recommendation, number>;
  /**
   * 按收盘值来源(etf=场内ETF真实K线 / nav=基金净值K线 / unknown=缺失)拆分的方向性统计。
   * 用于回答「有/无场内ETF数据的基金评分是否有差异、是否更不准」——直接对比两组准确率与样本量。
   */
  bySource: Record<ValueSource, SourceAccuracy>;
}

/** 单数据源的方向性统计 */
export interface SourceAccuracy {
  /** 已结算样本数（correct+wrong+neutral） */
  settled: number;
  /** 方向性样本数（correct+wrong） */
  directionalTotal: number;
  directionalCorrect: number;
  /** 方向性准确率 correct/(correct+wrong)，无方向性样本时为 null */
  directionalAccuracy: number | null;
  /** 已结算样本平均次日涨跌幅（剔除极值），无样本时为 null */
  avgNext: number | null;
}

/**
 * 次日涨跌幅合理上限（%）：超过此值视为单位换算/数据异常，不参与均值与命中统计。
 * 决策回填层(decisionSnapshot.reconcileSnapshots)已对 |pct|>30% 隔离为 unknown，
 * 此处作为统计层的二次兜底，使 computeBacktestStats 在原始数据上调用也安全。
 */
const MAX_NEXT_CHANGE_PCT = 50;

function isValidNext(pct: number | null): pct is number {
  return pct != null && !Number.isNaN(pct) && Math.abs(pct) <= MAX_NEXT_CHANGE_PCT;
}

const BUCKET_SIZE = 10;

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 计算回测统计汇总。
 * @param snapshots 全部快照
 */
export function computeBacktestStats(snapshots: ScoreSnapshot[]): BacktestStats {
  const settled = snapshots.filter(
    (s) => s.outcome === "correct" || s.outcome === "wrong" || s.outcome === "neutral",
  );

  const byRec: Record<Recommendation, number> = { buy: 0, hold: 0, sell: 0 };
  const settledByRec: Record<Recommendation, number> = { buy: 0, hold: 0, sell: 0 };
  const avgNextAccum: Record<Recommendation, number[]> = { buy: [], hold: [], sell: [] };

  const bySource: Record<
    ValueSource,
    { settled: number; directionalTotal: number; directionalCorrect: number; next: number[] }
  > = {
    etf: { settled: 0, directionalTotal: 0, directionalCorrect: 0, next: [] },
    nav: { settled: 0, directionalTotal: 0, directionalCorrect: 0, next: [] },
    unknown: { settled: 0, directionalTotal: 0, directionalCorrect: 0, next: [] },
  };

  let buyHits = 0;
  let buyTotal = 0;
  let sellHits = 0;
  let sellTotal = 0;
  let directionalCorrect = 0;
  let directionalTotal = 0;

  for (const s of snapshots) {
    byRec[s.recommendation]++;
    if (isValidNext(s.nextChangePct)) avgNextAccum[s.recommendation].push(s.nextChangePct);

    if (s.outcome === "correct" || s.outcome === "wrong" || s.outcome === "neutral") {
      settledByRec[s.recommendation]++;
      const src = bySource[s.valueSource];
      src.settled++;
      if (isValidNext(s.nextChangePct)) src.next.push(s.nextChangePct);
    }
    if (s.outcome === "correct" || s.outcome === "wrong") {
      if (s.recommendation !== "hold") directionalTotal++;
      if (s.outcome === "correct") {
        directionalCorrect++;
        if (s.recommendation === "buy") buyHits++;
        else if (s.recommendation === "sell") sellHits++;
      }
      if (s.recommendation === "buy") buyTotal++;
      else if (s.recommendation === "sell") sellTotal++;
      const src = bySource[s.valueSource];
      src.directionalTotal++;
      if (s.outcome === "correct") src.directionalCorrect++;
    }
  }

  // 评分区间命中分布
  // 关键修正：count/hitRate 仅统计方向性样本(correct/wrong)，但 settledCount 暴露全部已结算（含 neutral/hold），
  // 否则高分区间若全为持有建议会因 count=0 而「消失」，造成「样本有 60-74 分但 60-70 桶为空」的假矛盾。
  const bucketMap = new Map<
    number,
    { correct: number; wrong: number; settled: number; next: number[] }
  >();
  for (let lo = 0; lo < 100; lo += BUCKET_SIZE) {
    bucketMap.set(lo, { correct: 0, wrong: 0, settled: 0, next: [] });
  }
  for (const s of snapshots) {
    const lo = Math.min(90, Math.floor(s.score / BUCKET_SIZE) * BUCKET_SIZE);
    const b = bucketMap.get(lo)!;
    // 持有建议(neutral)无方向性押注：仅计入 settledCount 与 avgNext，不进入命中率分母
    if (s.outcome === "neutral") {
      b.settled++;
      if (isValidNext(s.nextChangePct)) b.next.push(s.nextChangePct);
      continue;
    }
    if (s.outcome !== "correct" && s.outcome !== "wrong") continue;
    b.correct++;
    b.wrong++;
    b.settled++;
    if (isValidNext(s.nextChangePct)) b.next.push(s.nextChangePct);
  }
  const buckets: BucketStat[] = [];
  for (let lo = 0; lo < 100; lo += BUCKET_SIZE) {
    const b = bucketMap.get(lo)!;
    const dirTotal = b.correct + b.wrong;
    buckets.push({
      bucket: lo === 90 ? "90-100" : `${lo}-${lo + BUCKET_SIZE}`,
      from: lo,
      to: lo + BUCKET_SIZE,
      count: dirTotal,
      settledCount: b.settled,
      hitRate: dirTotal > 0 ? b.correct / dirTotal : null,
      avgNext: avg(b.next),
    });
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
    directionalCoverage: settled.length > 0 ? directionalTotal / settled.length : null,
    avgNextByRec: {
      buy: avgNextAccum.buy.length ? avg(avgNextAccum.buy) : null,
      hold: avgNextAccum.hold.length ? avg(avgNextAccum.hold) : null,
      sell: avgNextAccum.sell.length ? avg(avgNextAccum.sell) : null,
    },
    buckets,
    settledByRec,
    bySource: {
      etf: toSourceAccuracy(bySource.etf),
      nav: toSourceAccuracy(bySource.nav),
      unknown: toSourceAccuracy(bySource.unknown),
    },
  };
}

function toSourceAccuracy(src: {
  settled: number;
  directionalTotal: number;
  directionalCorrect: number;
  next: number[];
}): SourceAccuracy {
  return {
    settled: src.settled,
    directionalTotal: src.directionalTotal,
    directionalCorrect: src.directionalCorrect,
    directionalAccuracy:
      src.directionalTotal > 0 ? src.directionalCorrect / src.directionalTotal : null,
    avgNext: src.next.length ? avg(src.next) : null,
  };
}

const REC_LABEL: Record<Recommendation, string> = { buy: "买入", hold: "持有", sell: "卖出" };
export function recommendationLabel(rec: Recommendation): string {
  return REC_LABEL[rec];
}

const OUTCOME_LABEL: Record<ScoreSnapshot["outcome"], string> = {
  pending: "待回填",
  correct: "命中",
  wrong: "未命中",
  neutral: "中性",
  unknown: "未知",
};
export function outcomeLabel(o: ScoreSnapshot["outcome"]): string {
  return OUTCOME_LABEL[o];
}

/**
 * 按快照日期聚合「每日方向性准确率」，用于按日回看趋势。
 * 仅纳入方向性样本（outcome 为 correct/wrong），中性/待回填不计。
 * @returns 按日期升序排列的数据点
 */
export function computeDailyAccuracySeries(snapshots: ScoreSnapshot[]): DailyAccuracyPoint[] {
  const byDate = new Map<string, { correct: number; wrong: number; next: number[] }>();
  for (const s of snapshots) {
    if (s.outcome !== "correct" && s.outcome !== "wrong") continue;
    const b = byDate.get(s.date) || { correct: 0, wrong: 0, next: [] };
    if (s.outcome === "correct") b.correct++;
    else b.wrong++;
    if (s.nextChangePct != null) b.next.push(s.nextChangePct);
    byDate.set(s.date, b);
  }
  const points: DailyAccuracyPoint[] = [];
  for (const [date, b] of byDate) {
    const dirTotal = b.correct + b.wrong;
    points.push({
      date,
      accuracy: dirTotal > 0 ? b.correct / dirTotal : null,
      sampleCount: dirTotal,
      avgNextChange: b.next.length ? avg(b.next) : null,
    });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  return points;
}
