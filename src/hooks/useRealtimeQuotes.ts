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
  console.log(`[useRealtimeQuotes] 被调用, codes=`, codes, `pollInterval=${pollInterval}`)
  
  const [valuations, setValuations] = useState<Record<string, RealtimeValuation>>({})
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  
  // 使用 ref 追踪最新状态，避免闭包陷阱
  const valuationsRef = useRef<Record<string, RealtimeValuation>>({})
  const codesRef = useRef<string[]>([])
  const etfMappingsRef = useRef(etfMappings)

  // 保持 ref 同步（不触发重渲染）
  codesRef.current = codes
  etfMappingsRef.current = etfMappings

  // 稳定化 codes 引用，防止无限重渲染
  const codesKey = useMemo(() => [...codes].sort().join(','), [codes])

  // 使用稳定的回调引用，避免因依赖变化导致 useEffect 重复触发
  const fetchQuotesInner = useCallback(async (codeList: string[], currentEtfMappings: { otcCode: string; exchangeCode: string }[], force = false) => {
    console.log(`[useRealtimeQuotes.fetchQuotesInner] 开始获取行情, force=${force}, codes=`, codeList)
    
    if (codeList.length === 0) {
      console.log(`[useRealtimeQuotes.fetchQuotesInner] 代码列表为空，直接返回`)
      return
    }

    // 非强制刷新时，优先走缓存
    if (!force) {
      console.log(`[useRealtimeQuotes.fetchQuotesInner] 尝试从缓存获取...`)
      const cached = await getQuotesCache(codeList)
      if (cached?.quotes?.length) {
        console.log(`[useRealtimeQuotes.fetchQuotesInner] ✅ 从缓存获取到 ${cached.quotes.length} 条行情`)
        const result = buildValuations(cached.quotes, codeList, currentEtfMappings)
        
        // 同时更新 state 和 ref
        setValuations(result)
        valuationsRef.current = result
        setLastUpdated(new Date())
        return
      } else {
        console.log(`[useRealtimeQuotes.fetchQuotesInner] 缓存未命中，准备从网络获取`)
      }
    }

    setLoading(true)

    try {
      console.log(`[useRealtimeQuotes.fetchQuotesInner] 正在调用 dataSourceService.fetchQuotes...`)
      const quotes = await dataSourceService.fetchQuotes(codeList)
      console.log(`[useRealtimeQuotes.fetchQuotesInner] 获取到 ${quotes.length} 条行情:`, quotes)
      
      // 缓存结果（klineCache 已有智能 TTL）
      if (quotes.length > 0) {
        console.log(`[useRealtimeQuotes.fetchQuotesInner] 缓存行情数据...`)
        setQuotesCache(codeList, quotes)
      }

      const result = buildValuations(quotes, codeList, currentEtfMappings)
      console.log(`[useRealtimeQuotes.fetchQuotesInner] 构建的 valuations:`, result)
      
      // 同时更新 state 和 ref（确保一致性）
      setValuations(result)
      valuationsRef.current = result
      setLastUpdated(new Date())
    } catch (e) {
      console.error('[RealtimeQuotes] fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, []) // 空依赖，保持稳定引用

  const refresh = useCallback(async () => {
    await fetchQuotesInner(codesRef.current, etfMappingsRef.current, true)
  }, [fetchQuotesInner])

  // 初始加载 + codes 变化时重新获取（使用 ref 避免闭包问题）
  useEffect(() => {
    // 立即使用最新的 ref 数据，不依赖 useCallback 的变化
    const codeList = codesKey ? codesKey.split(',') : []
    
    console.log(`[useRealtimeQuotes] useEffect 触发, codes=`, codeList, `codesKey=`, codesKey)
    
    if (codeList.length === 0) return
    
    // 直接调用 inner 函数，传入当前 ref 值
    fetchQuotesInner(codeList, etfMappingsRef.current, false)
  }, [codesKey, fetchQuotesInner]) // 只依赖 codesKey 变化

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
    valuations, // 使用 state（正常触发重渲染）
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
  console.log(`[buildValuations] 开始构建 valuations, quotes=`, quotes, `codes=`, codes, `etfMappings=`, etfMappings)
  
  const result: Record<string, RealtimeValuation> = {}
  const today = new Date().toISOString().slice(0, 10)
  console.log(`[buildValuations] 今天日期: ${today}`)

  for (const code of codes) {
    const quote = quotes.find((q) => q.code === code)
    const hasEtfMapping = etfMappings.some((m) => m.otcCode === code)

    console.log(`[buildValuations] 处理基金 ${code}: quote=`, quote, `hasEtfMapping=${hasEtfMapping}`)

    if (quote && quote.nav > 0.001 && quote.navDate) {
      result[code] = {
        quote,
        isRealtime: hasEtfMapping && quote.navDate === today,
        loading: false,
        error: null,
      }
      console.log(`[buildValuations] ✅ 基金 ${code} 数据有效: nav=${quote.nav}, dailyChange=${quote.dailyChange}`)
    } else {
      result[code] = {
        quote: null,
        isRealtime: false,
        loading: false,
        error: '暂无数据',
      }
      console.warn(`[buildValuations] ⚠️ 基金 ${code} 数据无效: quote=`, quote)
    }
  }
  console.log(`[buildValuations] 最终结果:`, result)
  return result
}
