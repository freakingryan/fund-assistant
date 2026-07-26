/**
 * 东财增强 — 共享 StockSDK 构造器
 *
 * 集中处理「直连 / Worker 反代」两种模式的 fetch 注入，供所有走东方财富的
 * 增强能力（资金面、板块赛道等）复用，避免每处重复构造逻辑。
 *
 * @module eastmoneySdk
 */

import StockSDK from "stock-sdk";
import type { EastmoneyDataSourceConfig } from "@/types";
import { buildProxyFetch } from "./proxyFetch";

/**
 * 构建带可选 Worker 代理的 StockSDK 实例。
 * 复用通用 `buildProxyFetch`：mode='proxy' 且填了 proxyUrl 时，把所有命中的
 * 东财/同花顺/巨潮请求经 Cloudflare Worker 反代（约定 Worker 转发时保留原 path+query）；
 * 否则直连东财（当前用户网络已实测可达）。
 */
export function buildEastmoneySdk(config: EastmoneyDataSourceConfig): StockSDK {
  const proxyFetch = buildProxyFetch(config);
  return new StockSDK({ fetchImpl: proxyFetch } as any);
}
