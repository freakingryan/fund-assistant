/**
 * Cloudflare Worker — 东方财富 / 同花顺 / 巨潮(互动易) 反向代理
 *
 * 前端在 mode='proxy' 时，会把命中下述域的请求改写到本 Worker 地址，
 * 并通过 `x-upstream-host` 请求头带上原始主机名。本 Worker 据此把请求转发到正确上游，
 * 保留原始 path + query，并附加 CORS 头，使浏览器端可跨域访问。
 *
 * 部署：
 *   cd worker && npx wrangler deploy
 * 前端配置：settings.dataSource.eastmoney = { enabled:true, mode:'proxy', proxyUrl:'https://<your-sub>.workers.dev' }
 *
 * 安全：仅允许转发到 eastmoney.com / 10jqka.com.cn / cninfo.com.cn 及其子域，
 * 杜绝被当作开放代理。
 */

const ALLOWED_HOST_RE =
  /([^/?#]+\.)*(?:eastmoney\.com|10jqka\.com\.cn|cninfo\.com\.cn|sinajs\.com\.cn|sina\.com\.cn)$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 原始上游主机：优先取请求头（由前端 stock-sdk 注入），其次 ?up= 兜底
    let upstream = request.headers.get("x-upstream-host") || url.searchParams.get("up");
    if (!upstream || !ALLOWED_HOST_RE.test(upstream)) {
      return new Response("missing or disallowed upstream host", { status: 400 });
    }

    // 还原上游 URL：去掉 worker 自身的 host，换上原始东财 host
    url.searchParams.delete("up");
    url.host = upstream;
    url.protocol = "https:";
    url.port = "";

    // 转发时移除控制头，避免污染上游
    const headers = new Headers(request.headers);
    headers.delete("x-upstream-host");

    // 新浪行情需 Referer（浏览器禁止头，由 Worker 注入）
    if (/sinajs\.com\.cn$|sina\.com\.cn$/.test(upstream)) {
      headers.set("Referer", `https://${upstream}/`);
      if (!headers.has("User-Agent")) {
        headers.set(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
        );
      }
    }

    const resp = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "follow",
    });

    // 附加 CORS，允许浏览器跨域读取
    const cors = new Headers(resp.headers);
    cors.set("Access-Control-Allow-Origin", "*");
    cors.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    cors.set("Access-Control-Allow-Headers", "*");

    // 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    return new Response(resp.body, { status: resp.status, headers: cors });
  },
};
