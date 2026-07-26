/**
 * 通用 Worker 反代 fetch 构造器
 *
 * 浏览器直连东方财富 / 同花顺 / 巨潮(互动易) 都会被 CORS 拦截，
 * 统一经 Cloudflare Worker 反代：前端把原始上游 host 通过 `x-upstream-host`
 * 请求头带给 Worker，Worker 据此转发到正确上游并附加 CORS 头。
 *
 * 仅当 settings.dataSource.eastmoney.mode='proxy' 且填了 proxyUrl 时启用反代；
 * 否则直连（东财当前网络可达；同花顺/巨潮直连会被 CORS 拦，属预期失败）。
 *
 * @module proxyFetch
 */

import type { EastmoneyDataSourceConfig } from "@/types";

/**
 * 反代覆盖的域名。Worker 的 allowlist（worker/index.js 的 ALLOWED_HOST_RE）
 * 必须同步放行这些域，否则 Worker 会拒绝转发。
 */
export const PROXY_HOST_RE =
  /^https?:\/\/([^/?#]+\.)*(?:eastmoney\.com|10jqka\.com\.cn|cninfo\.com\.cn|sinajs\.com\.cn|sina\.com\.cn)/i;

/**
 * 构建带可选 Worker 反代的 fetch 实现。
 * 命中三域的请求改写到 proxyUrl 并注入 `x-upstream-host`；其余请求直连。
 */
export function buildProxyFetch(config: EastmoneyDataSourceConfig): typeof fetch {
  if (config.mode === "proxy" && config.proxyUrl) {
    const proxyBase = config.proxyUrl.replace(/\/+$/, "");
    return async (input, init) => {
      let url: string;
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.href;
      else return fetch(input, init);

      if (PROXY_HOST_RE.test(url)) {
        const origHost = new URL(url).host;
        const headers = new Headers(init?.headers);
        headers.set("x-upstream-host", origHost);
        const rewritten = url.replace(PROXY_HOST_RE, proxyBase);
        return fetch(rewritten, { ...init, headers });
      }
      return fetch(url, init);
    };
  }
  return (input, init) => fetch(input, init);
}
