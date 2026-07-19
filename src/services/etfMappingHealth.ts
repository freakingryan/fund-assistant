import { dataSourceService } from '@/adapters/datasource/service'
import { useEtfHealthStore, ETF_HEALTH_TTL } from '@/stores/etfHealth'
import type { EtfMapping } from '@/types'

export interface EtfMappingHealth {
  otcCode: string
  otcName: string
  exchangeCode: string
  exchangeName: string
  ok: boolean
  checkedAt: number
  fromCache?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 检测 ETF 映射中「K 线端点取数失败」的项（即映射错误，会导致 K 线图无数据）。
 *
 * - 复用 UI 同款 `fetchEtfKLine`：返回空数组 = 该 ETF 代码无数据 = 映射错误。
 * - **正常的不重复检测**：exchangeCode 曾检测为健康且在 TTL 内 → 直接复用缓存，不发请求。
 * - 仅对「未缓存 / 已过期 / 曾出错」的项真正请求端点。
 *
 * @param mappings 现有 ETF 映射列表
 * @param opts.force 为 true 时忽略缓存，全部重新检测
 * @param opts.onProgress 每检测完一项回调 (done, total)
 */
export async function detectBrokenEtfMappings(
  mappings: EtfMapping[],
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ broken: EtfMappingHealth[]; healthy: EtfMappingHealth[]; all: EtfMappingHealth[] }> {
  const { force = false, onProgress } = opts
  const all: EtfMappingHealth[] = []
  let done = 0

  for (const m of mappings) {
    const cached = useEtfHealthStore.getState().get(m.exchangeCode)
    const fresh = !!cached && !force && cached.ok && Date.now() - cached.checkedAt < ETF_HEALTH_TTL

    let ok: boolean
    let checkedAt = Date.now()
    let fromCache = false

    if (fresh) {
      ok = cached.ok
      checkedAt = cached.checkedAt
      fromCache = true
    } else {
      try {
        const k = await dataSourceService.fetchEtfKLine(m.exchangeCode, '3m')
        ok = Array.isArray(k) && k.length > 0
      } catch {
        ok = false
      }
      useEtfHealthStore.getState().set(m.exchangeCode, ok)
      await sleep(150)
    }

    all.push({
      otcCode: m.otcCode,
      otcName: m.otcName,
      exchangeCode: m.exchangeCode,
      exchangeName: m.exchangeName,
      ok,
      checkedAt,
      fromCache,
    })
    done++
    onProgress?.(done, mappings.length)
  }

  const broken = all.filter((h) => !h.ok)
  const healthy = all.filter((h) => h.ok)
  return { broken, healthy, all }
}
