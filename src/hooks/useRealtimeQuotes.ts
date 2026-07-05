/**
 * useRealtimeQuotes — 实时行情 Hook
 *
 * 利用 ETF 映射查询实时行情，为持仓列表/详情页/Dashboard 提供实时估值数据。
 * 通过 stock-api（内置）或 AKShare（降级）获取数据，零后端依赖。
 *
 * 缓存策略：使用 klineCache 已有的 getQuotesCache/setQuotesCache
 * TTL 策略：交易时段内自动过期（A 股 9:30-15:00），非交易时段长缓存
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { dataSourceService } from '@/adapters/datasource/service'
import { getQuotesCache, setQuotesCache } from '@/services/klineCache'
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
  /** 刷新所有实时行情（跳过缓存强制拉取） */
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
  const mountedRef = useRef(true)

  // 稳定化 codes 引用，防止无限重渲染
  const codesKey = useMemo(() => [...codes].sort().join(','), [codes])

  const fetchQuotes = useCallback(async (force = false) => {
    const codeList = codesKey ? codesKey.split(',') : []
    if (codeList.length === 0) return

    // 非强制刷新时，优先走缓存
    if (!force) {
      const cached = await getQuotesCache(codeList)
      if (cached?.quotes?.length) {
        const result = buildValuations(cached.quotes, codeList, etfMappings)
        if (mountedRef.current) {
          setValuations(result)
          setLastUpdated(new Date())
        }
        return
      }
    }

    if (!mountedRef.current) return
    setLoading(true)

    try {
      const quotes = await dataSourceService.fetchQuotes(codeList)
      // 缓存结果（klineCache 已有智能 TTL）
      if (quotes.length > 0) setQuotesCache(codeList, quotes)

      const result = buildValuations(quotes, codeList, etfMappings)
      if (mountedRef.current) {
        setValuations(result)
        setLastUpdated(new Date())
      }
    } catch (e) {
      console.error('[RealtimeQuotes] fetch failed:', e)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [codesKey, etfMappings])

  // 初始加载
  useEffect(() => {
    mountedRef.current = true
    // 延迟 50ms 执行，让组件先完成初次渲染
    const t = setTimeout(() => fetchQuotes(false), 50)
    return () => { mountedRef.current = false; clearTimeout(t) }
  }, [fetchQuotes])

  // 轮询
  useEffect(() => {
    if (pollInterval <= 0) return
    timerRef.current = setInterval(() => fetchQuotes(false), pollInterval)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchQuotes, pollInterval])

  return {
    valuations,
    refresh: () => fetchQuotes(true),
    loading,
    lastUpdated,
  }
}

/** 从行情数组构建 valuations 映射 */
function buildValuations(
  quotes: FundQuote[],
  codes: string[],
  etfMappings: { otcCode: string; exchangeCode: string }[]
): Record<string, RealtimeValuation> {
  const result: Record<string, RealtimeValuation> = {}
  const today = new Date().toISOString().slice(0, 10)

  for (const code of codes) {
    const quote = quotes.find((q) => q.code === code)
    const hasEtfMapping = etfMappings.some((m) => m.otcCode === code)

    if (quote && quote.nav > 0.001 && quote.navDate) {
      result[code] = {
        quote,
        isRealtime: hasEtfMapping && quote.navDate === today,
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
  return result
}
