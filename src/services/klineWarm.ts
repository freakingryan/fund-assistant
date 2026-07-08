/**
 * K 线后台预热（Warm Cache）
 *
 * 应用打开（或标签页重新可见）时，静默预取「有 ETF 映射且基金名称含 ETF/指数」的
 * 场内真实 K 线数据，存入与详情页共用的 IndexedDB 缓存，使详情页切换「场内ETF真实K线」
 * 时无需等待加载。纯场外主动基金不预取（无真实 K 线意义，且默认展示净值走势）。
 *
 * 防护（与详情页请求共用同一套机制，绝不重复打接口、不触发限流）：
 *  - 每只基金先查缓存「是否存在 + 最后更新时间」，新鲜则跳过；
 *  - 复用 dataSourceService.fetchKLine / fetchEtfKLine，其内部已带
 *    内存缓存 + 同码去重 + 并发限流(3) + 源熔断，天然防拦截/限额；
 *  - 额外在两条预取之间加小幅间隔，进一步平滑突发请求；
 *  - 离线（navigator.onLine === false）时直接跳过，避免无意义失败；
 *  - 若场内 K 线三源全部进入「熔断冷却期」，整轮预取暂停，
 *    等冷却结束后再继续（避免对已知不可用的源反复打请求）；
 *  - 受设置项 preloadKline 开关控制（默认开启）。
 */
import { dataSourceService } from '@/adapters/datasource/service'
import { getKlineCooldownInfo } from '@/adapters/datasource/stock-api'
import { useHoldingsStore } from '@/stores/holdings'
import { useSettingsStore } from '@/stores/settings'
import { getKlineCacheTime, setKlineCache } from '@/services/klineCache'
import type { KLineData } from '@/types'

// 预热采用与详情页一致的默认周期，保证「进入即命中」
const WARM_PERIOD = '3m'
// 两条预取之间的最小间隔，平滑请求爆发（叠加底层并发限流=3 更安全）
const ISSUE_GAP_MS = 500

let warming = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 静默预热所有持仓的 K 线缓存。
 * - 每只基金都有「基金净值走势」缓存（key = fund.code）；
 * - 有 ETF 映射的，额外预热「场内 ETF 真实 K 线」（key = etf_<exchangeCode>）。
 * 写入的缓存键与详情页读取 / 写入的键完全一致，故预热后进入详情页即为瞬时命中。
 */
export async function warmKlineCache(opts?: { force?: boolean }): Promise<void> {
  if (warming) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (!useSettingsStore.getState().settings.preloadKline) return

  warming = true
  try {
    // 确保基础数据已就绪（首次打开时 settings/holdings 可能尚未加载完）
    const settingsStore = useSettingsStore.getState()
    if (!settingsStore.settings.etfMappings) await settingsStore.loadSettings()
    const holdingsStore = useHoldingsStore.getState()
    if (holdingsStore.holdings.length === 0) await holdingsStore.loadHoldings()

    const holdings = useHoldingsStore.getState().holdings
    const mappings = useSettingsStore.getState().settings.etfMappings
    if (holdings.length === 0) return

    type Task = { label: string; cacheKey: string; fetch: () => Promise<KLineData[]> }
    const tasks: Task[] = []
    for (const h of holdings) {
      if (!h.code || !/^\d{6}$/.test(h.code)) continue
      // 1) 基金净值走势（场外/场内通用）
      tasks.push({
        label: `NAV ${h.code}`,
        cacheKey: h.code,
        fetch: () => dataSourceService.fetchKLine(h.code, WARM_PERIOD),
      })
      // 2) 场内 ETF 真实 K 线：仅当基金名称含「ETF/指数」且有映射时才后台预热。
      //    纯场外主动基金无真实 K 线意义，避免无谓打接口 / 触发限流；
      //    命中详情页「场内ETF真实K线」开关时即瞬时命中缓存。
      const isKlineFund = /etf/i.test(h.name || '') || (h.name || '').includes('指数')
      const etfCode = mappings.find((m) => m.otcCode === h.code)?.exchangeCode
      if (isKlineFund && etfCode && /^\d{6}$/.test(etfCode)) {
        tasks.push({
          label: `ETF ${etfCode}`,
          cacheKey: `etf_${etfCode}`,
          fetch: () => dataSourceService.fetchEtfKLine(etfCode, WARM_PERIOD),
        })
      }
    }

    let fetched = 0
    let skipped = 0
    let failed = 0
    // 熔断冷却期：整轮预取最多暂停等待一次，避免三源全熔断时反复打接口、也避免无限挂起
    let cooldownPauseUsed = false
    for (const t of tasks) {
      try {
        // 先检查缓存是否存在 + 最后更新时间；新鲜则跳过（避免无谓请求/触发限流）
        const fresh = await getKlineCacheTime(t.cacheKey, WARM_PERIOD)
        if (fresh !== null && !opts?.force) {
          skipped++
          continue
        }

        // 熔断冷却期保护：仅场内 ETF 真实 K 线（etf_ 键）依赖三源；
        // 若三源全部处于冷却期，则整轮暂停预取，等最早冷却结束再继续，
        // 与详情页「源熔断后自动恢复」机制呼应，避免对已知不可用的源反复打请求。
        if (t.cacheKey.startsWith('etf_') && !cooldownPauseUsed) {
          const cd = getKlineCooldownInfo()
          if (cd.allBroken && cd.earliestResumeAt) {
            const wait = cd.earliestResumeAt - Date.now()
            if (wait > 0) {
              console.info(
                `[K线预热] 场内K线三源处于熔断冷却期，暂停预取 ${Math.ceil(wait / 1000)}s，冷却结束后继续...`,
              )
              await sleep(wait)
              cooldownPauseUsed = true
              // 冷却结束重新校验本任务缓存（可能被详情页/其它途径在等待期间命中），新鲜则跳过
              const fresh2 = await getKlineCacheTime(t.cacheKey, WARM_PERIOD)
              if (fresh2 !== null && !opts?.force) {
                skipped++
                await sleep(ISSUE_GAP_MS)
                continue
              }
              // 仍不新鲜 → 冷却已结束，下方 fetch 会重新尝试三源（可能恢复）
            }
          }
        }

        const data = await t.fetch()
        if (data && data.length > 0) {
          await setKlineCache(t.cacheKey, WARM_PERIOD, data)
          fetched++
        } else {
          // 空数据不写缓存：避免把「暂无数据」长期缓存成假命中
          failed++
        }
      } catch (e) {
        failed++
        console.warn(`[K线预热] 预取失败 ${t.label}:`, e)
      }
      await sleep(ISSUE_GAP_MS)
    }
    console.info(
      `[K线预热] 完成：预取 ${fetched} 项，跳过(已新鲜) ${skipped} 项，失败/空 ${failed} 项`,
    )
  } catch (e) {
    console.warn('[K线预热] 预热异常', e)
  } finally {
    warming = false
  }
}
