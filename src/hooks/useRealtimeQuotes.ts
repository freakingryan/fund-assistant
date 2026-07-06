/**
 * useRealtimeQuotes — 实时行情 Hook
 *
 * 利用 ETF 映射查询实时行情，为持仓列表/详情页/Dashboard 提供实时估值数据。
 * 通过 stock-api + fundgz + pingzhongdata 获取数据，零后端依赖。
 *
 * 缓存策略：使用 klineCache 已有的 getQuotesCache/setQuotesCache
 * TTL 策略：交易时段内自动过期（A 股 9:30-15:00），非交易时段长缓存
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { dataSourceService } from '@/adapters/datasource/service'
import { getQuotesCache, setQuotesCache } from '@/services/klineCache'
import { useSettingsStore } from '@/stores/settings'
import type { FundQuote } from '@/types'
import { toast } from '@/components/ui/toast'

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
  
  // 使用 ref 追踪最新状态，避免闭包陷阱
  const valuationsRef = useRef<Record<string, RealtimeValuation>>({})
  const codesRef = useRef<string[]>([])
  const etfMappingsRef = useRef(etfMappings)

  // 保持 ref 同步（不触发重渲染）：放到 effect 中，避免渲染期访问 ref
  useEffect(() => {
    codesRef.current = codes
    etfMappingsRef.current = etfMappings
  }, [codes, etfMappings])

  // 稳定化 codes 引用，防止无限重渲染
  const codesKey = useMemo(() => [...codes].sort().join(','), [codes])

  // 使用稳定的回调引用，避免因依赖变化导致 useEffect 重复触发
  const fetchQuotesInner = useCallback(async (codeList: string[], currentEtfMappings: { otcCode: string; exchangeCode: string }[], force = false) => {
    if (codeList.length === 0) return

    // 非强制刷新时，优先走缓存
    if (!force) {
      const cached = await getQuotesCache(codeList)
      if (cached?.quotes?.length) {
        const result = buildValuations(cached.quotes, codeList, currentEtfMappings)
        setValuations(result)
        valuationsRef.current = result
        setLastUpdated(new Date())
        return
      }
    }

    setLoading(true)

    try {
      const quotes = await dataSourceService.fetchQuotes(codeList)
      
      // 缓存结果（klineCache 已有智能 TTL）
      if (quotes.length > 0) {
        setQuotesCache(codeList, quotes)
      }

      const result = buildValuations(quotes, codeList, currentEtfMappings)
      
      // 同时更新 state 和 ref（确保一致性）
      setValuations(result)
      valuationsRef.current = result
      setLastUpdated(new Date())
    } catch {
      toast({ type: 'error', message: '行情更新失败，请检查网络' })
    } finally {
      setLoading(false)
    }
  }, []) // 空依赖，保持稳定引用

  const refresh = useCallback(async () => {
    await fetchQuotesInner(codesRef.current, etfMappingsRef.current, true)
  }, [fetchQuotesInner])

  // 初始加载 + codes 变化时重新获取（使用 ref 避免闭包问题）
  useEffect(() => {
    const codeList = codesKey ? codesKey.split(',') : []
    if (codeList.length === 0) return
    fetchQuotesInner(codeList, etfMappingsRef.current, false)
  }, [codesKey, fetchQuotesInner])

  // 轮询（使用 ref 获取最新数据）
  useEffect(() => {
    if (pollInterval <= 0) return
    timerRef.current = setInterval(() => {
      fetchQuotesInner(codesRef.current, etfMappingsRef.current, false)
    }, pollInterval)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [pollInterval, fetchQuotesInner])

  return {
    valuations,
    refresh,
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
