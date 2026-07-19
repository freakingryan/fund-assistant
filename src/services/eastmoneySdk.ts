/**
 * 东财增强 — 共享 StockSDK 构造器
 *
 * 集中处理「直连 / Worker 反代」两种模式的 fetch 注入，供所有走东方财富的
 * 增强能力（资金面、板块赛道等）复用，避免每处重复构造逻辑。
 *
 * @module eastmoneySdk
 */

import StockSDK from 'stock-sdk'
import type { EastmoneyDataSourceConfig } from '@/types'

const EASTMONEY_HOST_RE = /^https?:\/\/([^/?#]+\.)*eastmoney\.com/i

/**
 * 构建带可选 Worker 代理的 StockSDK 实例。
 * - mode='proxy' 且填了 proxyUrl：把所有发往 *.eastmoney.com 的请求改写到 proxyUrl
 *   （Cloudflare Worker 反代），约定 Worker 转发时保留原 path+query。
 * - 否则：直连东财（当前用户网络已实测可达，无需 Worker）。
 */
export function buildEastmoneySdk(config: EastmoneyDataSourceConfig): StockSDK {
  if (config.mode === 'proxy' && config.proxyUrl) {
    const proxyBase = config.proxyUrl.replace(/\/+$/, '')
    const proxyFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      const rewritten = EASTMONEY_HOST_RE.test(url) ? url.replace(EASTMONEY_HOST_RE, proxyBase) : url
      return fetch(rewritten, init)
    }
    return new StockSDK({ fetchImpl: proxyFetch } as any)
  }
  return new StockSDK()
}
