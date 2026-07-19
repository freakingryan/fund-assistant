/**
 * K 线形态检测引擎
 *
 * 三层架构：
 * L1 — CandleFeatures: 单 K 线特征提取（实体/影线/颜色/幅度分类）
 * L2 — 单 K 线形态匹配: 基于 L1 特征匹配 16+ 种基础形态
 * L3 — 多 K 线组合模式: 基于 L2 序列检测吞没/晨星/暮星/三连等复合形态
 *
 * 设计原则：
 * - L1+L2 无 AI 依赖，纯前端算法，即开即用
 * - L3 部分组合（吞没/三连）纯算法检测
 * - 所有检测结果可输入 AI 提示词作为上下文
 */

import type { KLineData } from '../types'

// ─── L1: 特征提取 ─────────────────────────────────────────

export interface CandleFeatures {
  bodySize: number
  bodyRatio: number // 0~1, body / totalRange
  upperShadow: number
  upperRatio: number // 0~1, upperShadow / totalRange
  lowerShadow: number
  lowerRatio: number // 0~1, lowerShadow / totalRange
  isBullish: boolean
  totalRange: number // high - low
  bodyCategory: 'star' | 'small' | 'medium' | 'large'
}

/** 实体幅度阈值 */
const BODY_STAR = 0.03 // < 3% → 星线
const BODY_SMALL = 0.08 // < 8% → 小
const BODY_MEDIUM = 0.16 // < 16% → 中, ≥ 16% → 大

/**
 * 对单根 K 线提取数值特征
 */
export function extractFeatures(candle: KLineData): CandleFeatures {
  const { open, close, high, low } = candle
  const totalRange = high - low
  if (totalRange === 0) {
    return {
      bodySize: 0,
      bodyRatio: 0,
      upperShadow: 0,
      upperRatio: 0,
      lowerShadow: 0,
      lowerRatio: 0,
      isBullish: close >= open,
      totalRange: 0,
      bodyCategory: 'star',
    }
  }

  const bodySize = Math.abs(close - open)
  const bodyRatio = bodySize / totalRange
  const upperShadow = high - Math.max(open, close)
  const upperRatio = upperShadow / totalRange
  const lowerShadow = Math.min(open, close) - low
  const lowerRatio = lowerShadow / totalRange

  let bodyCategory: CandleFeatures['bodyCategory']
  if (bodyRatio < BODY_STAR) bodyCategory = 'star'
  else if (bodyRatio < BODY_SMALL) bodyCategory = 'small'
  else if (bodyRatio < BODY_MEDIUM) bodyCategory = 'medium'
  else bodyCategory = 'large'

  return {
    bodySize,
    bodyRatio,
    upperShadow,
    upperRatio,
    lowerShadow,
    lowerRatio,
    isBullish: close >= open,
    totalRange,
    bodyCategory,
  }
}

// ─── L2: 单 K 线形态 ──────────────────────────────────────

export type SingleCandlePattern =
  | 'doji'
  | 'long_legged_doji'
  | 't_line'
  | 'inverted_t_line'
  | 'hammer'
  | 'shooting_star'
  | 'bullish_marubozu'
  | 'bearish_marubozu'
  | 'lower_shadow_yang'
  | 'lower_shadow_yin'
  | 'upper_shadow_yang'
  | 'upper_shadow_yin'
  | 'small_yang'
  | 'small_yin'

/** 单 K 线形态判断结果 */
export interface SingleCandleMatch {
  type: SingleCandlePattern
  confidence: number // 0~1
  description: string
  direction: 'bullish' | 'bearish' | 'neutral'
}

const SHADOW_THRESHOLD = 1.5 // 影线 ≥ 1.5× 实体视为显著
const HAMMER_SHADOW = 2.0 // 锤子线特有阈值

/**
 * 匹配单根 K 线的最显著形态（L2）
 * 返回匹配列表——同一根 K 线可能匹配多种形态（如十字星 + 长十字星），
 * 取置信度最高的两种返回；无匹配则返回空数组。
 */
export function matchSingleCandle(feat: CandleFeatures): SingleCandleMatch[] {
  const matches: SingleCandleMatch[] = []
  const { bodyRatio, upperRatio, lowerRatio, upperShadow, lowerShadow, bodySize, isBullish, bodyCategory, totalRange } = feat

  // ── 十字星系 ──
  if (bodyRatio < 0.05) {
    // 长十字星（上下影线均显著）
    if (upperShadow > 2 * bodySize && lowerShadow > 2 * bodySize && totalRange > 0) {
      matches.push({
        type: 'long_legged_doji',
        confidence: 0.85,
        description: '长十字星：多空激烈争夺，即将出现方向性反转',
        direction: 'neutral',
      })
    }

    // T 字线（close ≈ high）
    if (upperRatio < 0.02 && lowerRatio > 0.3) {
      matches.push({
        type: 't_line',
        confidence: 0.8,
        description: 'T字线：下方支撑强劲，看涨信号',
        direction: 'bullish',
      })
    }

    // 倒 T 字线（close ≈ low）
    if (lowerRatio < 0.02 && upperRatio > 0.3) {
      matches.push({
        type: 'inverted_t_line',
        confidence: 0.8,
        description: '倒T字线：上方抛压沉重，看跌信号',
        direction: 'bearish',
      })
    }

    // 普通十字星（若无更强烈的十字星变体）
    if (!matches.some((m) => m.type === 'long_legged_doji' || m.type === 't_line' || m.type === 'inverted_t_line')) {
      matches.push({
        type: 'doji',
        confidence: 0.7,
        description: '十字星：多空力量均衡，方向选择即将出现',
        direction: 'neutral',
      })
    }
  }

  // ── 锤子线（不论颜色，传统技术分析均视为看涨反转信号） ──
  if (bodyRatio < 0.3 && lowerShadow > HAMMER_SHADOW * bodySize && upperShadow < bodySize / 3) {
    matches.push({
      type: 'hammer',
      confidence: 0.8,
      description: `锤子线：长下影表明下方买盘承接有力，${isBullish ? '阳线' : '阴线'}形态更显支撑`,
      direction: 'bullish',
    })
  }

  // ── 射击之星 / 倒锤线 ──
  if (bodyRatio < 0.3 && upperShadow > HAMMER_SHADOW * bodySize && lowerShadow < bodySize / 3) {
    matches.push({
      type: 'shooting_star',
      confidence: 0.8,
      description: '射击之星：上影线揭示上方抛压严重，短线偏空',
      direction: 'bearish',
    })
  }

  // ── 光头光脚阳线 / 阴线（Marubozu） ──
  if (upperShadow < 0.001 && lowerShadow < 0.001 && bodyCategory !== 'star') {
    if (isBullish) {
      matches.push({
        type: 'bullish_marubozu',
        confidence: 0.9,
        description: '光头光脚大阳线：单边上涨，多方强势控盘',
        direction: 'bullish',
      })
    } else {
      matches.push({
        type: 'bearish_marubozu',
        confidence: 0.9,
        description: '光头光脚大阴线：单边下跌，空方强势控盘',
        direction: 'bearish',
      })
    }
  }

  // ── 下影线类形态 ──
  if (lowerShadow > SHADOW_THRESHOLD * bodySize && bodyCategory !== 'star' && upperShadow < bodySize) {
    if (isBullish) {
      matches.push({
        type: 'lower_shadow_yang',
        confidence: 0.75,
        description: '下影阳线：先抑后扬，下方支撑有力',
        direction: 'bullish',
      })
    } else {
      matches.push({
        type: 'lower_shadow_yin',
        confidence: 0.7,
        description: '下影阴线：虽收阴但长下影表明下方有买盘承接，潜在反转信号',
        direction: 'bullish',
      })
    }
  }

  // ── 上影线类形态 ──
  if (upperShadow > SHADOW_THRESHOLD * bodySize && bodyCategory !== 'star' && lowerShadow < bodySize) {
    if (isBullish) {
      matches.push({
        type: 'upper_shadow_yang',
        confidence: 0.7,
        description: '上影阳线：冲高回落，需结合位置判断（高位偏空/低位洗盘）',
        direction: 'neutral',
      })
    } else {
      matches.push({
        type: 'upper_shadow_yin',
        confidence: 0.75,
        description: '上影阴线：上方抛压沉重且收阴，偏空信号',
        direction: 'bearish',
      })
    }
  }

  // ── 小阳线 / 小阴线 ──
  if (bodyCategory === 'small' && upperShadow < bodySize && lowerShadow < bodySize) {
    if (isBullish) {
      matches.push({
        type: 'small_yang',
        confidence: 0.6,
        description: '小阳线：小幅上涨，趋势强度有限，建议观望',
        direction: 'neutral',
      })
    } else {
      matches.push({
        type: 'small_yin',
        confidence: 0.6,
        description: '小阴线：小幅下跌，趋势强度有限，建议观望',
        direction: 'neutral',
      })
    }
  }

  // 去重（同一类型只保留置信度最高的）
  const seen = new Set<SingleCandlePattern>()
  return matches.filter((m) => {
    if (seen.has(m.type)) return false
    seen.add(m.type)
    return true
  })
}

// ─── L3: 多 K 线组合模式 ─────────────────────────────

export type MultiCandlePattern =
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'morning_star'
  | 'evening_star'
  | 'three_white_soldiers'
  | 'three_black_crows'

/** 组合形态检测结果 */
export interface MultiCandleMatch {
  type: MultiCandlePattern
  endIndex: number // 在原始数组中的末位索引
  candleCount: number // 覆盖的 K 线数
  confidence: number
  description: string
  direction: 'bullish' | 'bearish'
}

/**
 * 检测多 K 线组合形态（L3）
 * 需要前 N 根 K 线的原始数据和它们的 L1 特征。
 */
export function detectMultiPatterns(
  data: KLineData[],
  features: CandleFeatures[],
): MultiCandleMatch[] {
  const results: MultiCandleMatch[] = []
  const len = data.length
  if (len < 3) return results

  // ── 吞没形态（2 K 线） ──
  for (let i = 1; i < len; i++) {
    const prev = data[i - 1]
    const curr = data[i]
    const prevIsBullish = prev.close >= prev.open
    const currIsBullish = curr.close >= curr.open

    // 看涨吞没：前阴后阳，阳实体完全包裹阴实体
    if (!prevIsBullish && currIsBullish) {
      const prevBody = prev.open - prev.close
      const currBody = curr.close - curr.open
      if (currBody > prevBody && curr.close > prev.open && curr.open < prev.close) {
        results.push({
          type: 'bullish_engulfing',
          endIndex: i,
          candleCount: 2,
          confidence: 0.85,
          description: '看涨吞没：阳线实体完全覆盖前一根阴线，多头反攻强烈',
          direction: 'bullish',
        })
      }
    }

    // 看跌吞没：前阳后阴，阴实体完全包裹阳实体
    if (prevIsBullish && !currIsBullish) {
      const prevBody = prev.close - prev.open
      const currBody = curr.open - curr.close
      if (currBody > prevBody && curr.open > prev.close && curr.close < prev.open) {
        results.push({
          type: 'bearish_engulfing',
          endIndex: i,
          candleCount: 2,
          confidence: 0.85,
          description: '看跌吞没：阴线实体完全覆盖前一根阳线，空头反扑强烈',
          direction: 'bearish',
        })
      }
    }
  }

  // ── 晨星 / 暮星（3 K 线） ──
  for (let i = 2; i < len; i++) {
    const c0 = data[i - 2]; const f0 = features[i - 2]
    const f1 = features[i - 1]
    const c2 = data[i]; const f2 = features[i]

    const c0IsBullish = c0.close >= c0.open
    const c2IsBullish = c2.close >= c2.open
    const isStarBody = f1.bodyCategory === 'star' || f1.bodyCategory === 'small'

    // 晨星：大阴 → 小实体 → 大阳
    if (!c0IsBullish && f0.bodyCategory === 'large' && isStarBody && c2IsBullish && f2.bodyCategory === 'large') {
      results.push({
        type: 'morning_star',
        endIndex: i,
        candleCount: 3,
        confidence: 0.8,
        description: '晨星形态：底部反转组合，下跌动能衰竭后多头反攻',
        direction: 'bullish',
      })
    }

    // 暮星：大阳 → 小实体 → 大阴
    if (c0IsBullish && f0.bodyCategory === 'large' && isStarBody && !c2IsBullish && f2.bodyCategory === 'large') {
      results.push({
        type: 'evening_star',
        endIndex: i,
        candleCount: 3,
        confidence: 0.8,
        description: '暮星形态：顶部反转组合，上涨动能衰竭后空头反扑',
        direction: 'bearish',
      })
    }
  }

  // ── 三连阳 / 三连阴（3 K 线） ──
  for (let i = 2; i < len; i++) {
    const prevCandle = data[i - 2]; const f0 = features[i - 2]
    const currCandle = data[i - 1]; const f1 = features[i - 1]
    const nextCandle = data[i]; const f2 = features[i]

    const bullish = [prevCandle, currCandle, nextCandle].map((c) => c.close >= c.open)
    const bodies = [f0, f1, f2].map((f) => f.bodySize)

    // 三连阳：连续 3 根阳线，实体递增（实体强度递增为佳）
    if (bullish.every(Boolean) && bodies[0] > 0 && bodies[1] > 0 && bodies[2] > 0 &&
        bodies[1] >= bodies[0] * 0.8 && bodies[2] >= bodies[1] * 0.8) {
      results.push({
        type: 'three_white_soldiers',
        endIndex: i,
        candleCount: 3,
        confidence: 0.75,
        description: '三连阳（三白兵）：连续三日上涨，多头稳步推进',
        direction: 'bullish',
      })
    }

    // 三连阴：连续 3 根阴线，实体递增
    if (bullish.every((b) => !b) && bodies[0] > 0 && bodies[1] > 0 && bodies[2] > 0 &&
        bodies[1] >= bodies[0] * 0.8 && bodies[2] >= bodies[1] * 0.8) {
      results.push({
        type: 'three_black_crows',
        endIndex: i,
        candleCount: 3,
        confidence: 0.75,
        description: '三连阴（三只乌鸦）：连续三日下跌，空头稳步推进',
        direction: 'bearish',
      })
    }
  }

  return results
}

// ─── 统一导出 ─────────────────────────────────────────

/** 所有形态的联合类型 */
export type KlinePattern = SingleCandlePattern | MultiCandlePattern

/** 检测到的形态 */
export interface DetectedPattern {
  type: KlinePattern
  index: number // K 线数组中的最后位置
  confidence: number
  description: string
  direction: 'bullish' | 'bearish' | 'neutral'
  isMultiCandle: boolean
  candleCount: number // 多 K 线时的组合跨度
}

/**
 * 主入口：对一组 K 线数据进行全部分层检测
 *
 * 1. 对每根 K 线运行 L1 特征提取
 * 2. 对每根 K 线运行 L2 单 K 线匹配
 * 3. 对整个数组运行 L3 多 K 线组合检测
 * 4. 合并结果，按末位索引排序
 */
export function detectPatterns(data: KLineData[]): DetectedPattern[] {
  if (!data || data.length === 0) return []

  // L1
  const features = data.map(extractFeatures)

  // L2
  const singleResults: DetectedPattern[] = []
  for (let i = 0; i < data.length; i++) {
    const matches = matchSingleCandle(features[i])
    for (const m of matches) {
      singleResults.push({
        type: m.type,
        index: i,
        confidence: m.confidence,
        description: m.description,
        direction: m.direction,
        isMultiCandle: false,
        candleCount: 1,
      })
    }
  }

  // L3
  const multiResults = detectMultiPatterns(data, features).map((m) => {
    const result: DetectedPattern = {
      type: m.type,
      index: m.endIndex,
      confidence: m.confidence,
      description: m.description,
      direction: m.direction,
      isMultiCandle: true,
      candleCount: m.candleCount,
    }
    return result
  })

  // 合并 & 排序（按位置从前到后）
  return [...singleResults, ...multiResults].sort((a, b) => a.index - b.index)
}

// ─── 工具函数 ─────────────────────────────────────────

/**
 * 将检测到的形态列表格式化为易读的文本摘要
 * 用于 AI Prompt 上下文或 UI 显示
 */
export function formatPatternsSummary(patterns: DetectedPattern[], data: KLineData[]): string {
  if (patterns.length === 0) return '未检测到显著 K 线形态'

  const lines: string[] = []
  for (const p of patterns) {
    const date = data[p.index]?.date || ''
    const tag = p.direction === 'bullish' ? '📈' : p.direction === 'bearish' ? '📉' : '➖'
    const type = p.isMultiCandle ? `${p.candleCount}K组合` : '单K'
    lines.push(`${tag} [${date}] ${p.description}（${type}, 置信度: ${(p.confidence * 100).toFixed(0)}%）`)
  }
  return lines.join('\n')
}

/**
 * 获取特定位置 K 线的形态名称（用于图表标注，取置信度最高的）
 */
export function getPatternLabel(patterns: DetectedPattern[], index: number): string | null {
  const atIndex = patterns.filter((p) => p.index === index && !p.isMultiCandle)
  if (atIndex.length === 0) return null
  const best = atIndex.reduce((a, b) => (a.confidence > b.confidence ? a : b))
  return PATTERN_LABELS[best.type] || best.type
}

/** 单 K 线形态中文标签（用于图表/列表显示） */
const PATTERN_LABELS: Partial<Record<SingleCandlePattern, string>> = {
  doji: '十字星',
  long_legged_doji: '长十字',
  t_line: 'T字线',
  inverted_t_line: '倒T字',
  hammer: '锤子线',
  shooting_star: '射击星',
  bullish_marubozu: '光头阳',
  bearish_marubozu: '光头阴',
  lower_shadow_yang: '下影阳',
  lower_shadow_yin: '下影阴',
  upper_shadow_yang: '上影阳',
  upper_shadow_yin: '上影阴',
  small_yang: '小阳线',
  small_yin: '小阴线',
}

/** 多 K 线组合形态中文标签 */
const MULTI_PATTERN_LABELS: Partial<Record<MultiCandlePattern, string>> = {
  bullish_engulfing: '看涨吞没',
  bearish_engulfing: '看跌吞没',
  morning_star: '晨星',
  evening_star: '暮星',
  three_white_soldiers: '三连阳',
  three_black_crows: '三连阴',
}

/**
 * 获取某条检测结果的统一中文显示名（同时支持单 K 与组合形态）。
 * 用于形态列表与 hover tooltip，避免组合形态回退到原始英文 type。
 */
export function getPatternDisplayName(p: DetectedPattern): string {
  if (p.isMultiCandle) return MULTI_PATTERN_LABELS[p.type as MultiCandlePattern] || p.type
  return PATTERN_LABELS[p.type as SingleCandlePattern] || p.type
}
