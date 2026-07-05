/**
 * useRealtimeQuotes — 实时行情 Hook
 *
 * 利用 ETF 映射查询实时行情，为持仓列表/详情页/Dashboard 提供实时估值数据。
 * 通过 stock-api（内置）或 AKShare（降级）获取数据，零后端依赖。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { dataSourceService } from '@/adapters/datasource/service'
import { useSettingsStore } from '@/stores/settings'
import type { FundQuote } from '@/types'

export interface RealtimeValuation {
  /** 基金代码对应的实时行情 */
  quote: FundQuote | null
  /** 是否为 ETF 实时估值（stock-api 获取）还是盘后净值 */
  isRealtime: boolean
  /** 数据是否正在加载 */
  loading: boolean
  /** 错误信息 */
  error: string | null
}

export interface RealtimeQuotesResult {
  /** code → RealtimeValuation 映射 */
  valuations: Record<string, RealtimeValuation>
  /** 刷新所有实时行情 */
  refresh: () => Promise<void>
  /** 全局加载状态 */
  loading: boolean
  /** 上次更新时间 */
  lastUpdated: Date | null
}

/**
 * 批量获取持仓的实时行情
 * @param codes 基金代码列表
 * @param pollInterval 轮询间隔（毫秒），0 表示不轮询
 */
export function useRealtimeQuotes(
  codes: string[],
  pollInterval = 0
): RealtimeQuotesResult {
  const [valuations, setValuations] = useState<Record<string, RealtimeValuation>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchQuotes = useCallback(async () => {
    if (codes.length === 0) return
    setLoading(true)

    try {
      // 批量获取所有基金的行情（适配器链优先使用 stock-api）
      const quotes = await dataSourceService.fetchQuotes(codes)

      // 构建结果映射
      const result: Record<string, RealtimeValuation> = {}

      for (const code of codes) {
        const quote = quotes.find((q) => q.code === code)
        const mapping = etfMappings.find((m) => m.otcCode === code)
        const hasEtfMapping = !!mapping

        if (quote && quote.nav > 0.001 && quote.navDate) {
          result[code] = {
            quote,
            // 有 ETF 映射且净值日期是今天 → 实时行情
            // 有 ETF 映射但净值日期不是今天 → 盘后净值
            // 无 ETF 映射 → 始终是盘后净值
            isRealtime: hasEtfMapping && quote.navDate === new Date().toISOString().slice(0, 10),
            loading: false,
            error: null,
          }
        } else {
          result[code] = {
            quote: null,
            isRealtime: false,
            loading: false,
            error: '暂无数据',
          }
        }
      }

      setValuations(result)
      setLastUpdated(new Date())
    } catch (e) {
      console.error('[RealtimeQuotes] fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [codes.join(','), etfMappings])

  // 初始加载
  useEffect(() => {
    fetchQuotes()
  }, [fetchQuotes])

  // 轮询
  useEffect(() => {
    if (pollInterval <= 0) return
    timerRef.current = setInterval(fetchQuotes, pollInterval)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchQuotes, pollInterval])

  return { valuations, refresh: fetchQuotes, loading, lastUpdated }
}

/**
 * 获取单只基金的实时估值。
 * 有 ETF 映射时使用实时行情估算，否则返回盘后净值。
 */
export function useFundRealtimeQuote(code: string): RealtimeValuation {
  const { valuations } = useRealtimeQuotes(code ? [code] : [], 0)
  return valuations[code] || { quote: null, isRealtime: false, loading: true, error: null }
}
