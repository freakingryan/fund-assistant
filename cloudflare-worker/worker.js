// Cloudflare Worker：东方财富数据代理
//
// 解决的问题：用户本地网络（含代理）无法访问 *.eastmoney.com，导致基金净值历史、
// F10 持仓、实时估值、基金搜索等接口全部失败。本 Worker 部署在 Cloudflare 边缘节点
// （境外，可达东财），由 Worker 服务端请求东方财富，前端只与本 Worker 通信，
// 彻底绕开本地网络对东财的阻断。免费额度足够个人使用。
//
// 支持路径（对应前端调用）：
//   /pingzhongdata/{code}.js   -> https://fund.eastmoney.com/pingzhongdata/{code}.js
//   /fundgz/js/{code}.js       -> https://fundgz.1234567.com.cn/js/{code}.js
//   /fundsuggest/{path}        -> https://fundsuggest.eastmoney.com/{path}
//   /fundf10/{path}            -> https://fundf10.eastmoney.com/{path}  （注入 eastmoney Referer）

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
}

function corsResponse(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } })
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return corsResponse(204, null)
    }
    if (request.method !== 'GET') {
      return corsResponse(405, 'Method Not Allowed')
    }

    const url = new URL(request.url)
    const { pathname, search } = url

    let target = null
    let needReferer = false

    if (pathname.startsWith('/pingzhongdata/')) {
      target = 'https://fund.eastmoney.com' + pathname + search
    } else if (pathname.startsWith('/fundgz/')) {
      target = 'https://fundgz.1234567.com.cn' + pathname.replace('/fundgz', '') + search
    } else if (pathname.startsWith('/fundsuggest/')) {
      target = 'https://fundsuggest.eastmoney.com' + pathname.replace('/fundsuggest', '') + search
    } else if (pathname.startsWith('/fundf10/')) {
      target = 'https://fundf10.eastmoney.com' + pathname.replace('/fundf10', '') + search
      needReferer = true // fundf10 强制校验 eastmoney Referer
    } else {
      return corsResponse(404, 'Unsupported path')
    }

    try {
      const upstream = await fetch(
        target,
        needReferer ? { headers: { Referer: 'https://fundf10.eastmoney.com/' } } : undefined,
      )
      const headers = new Headers(upstream.headers)
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
      headers.set('cache-control', 'no-store')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (e) {
      return corsResponse(502, 'Upstream error: ' + (e && e.message ? e.message : String(e)))
    }
  },
}
