/**
 * 数据获取工具模块
 *
 * fundgz.1234567.com.cn — 基金实时估算净值（JSONP，无 CORS）
 * fund.eastmoney.com/pingzhongdata — 基金历史数据（JS，无 CORS）
 *
 * 策略：统一用 <script> 标签（JSONP）加载——<script> 跨域不受 CORS 限制，
 * 开发与生产行为完全一致，无需 Vite proxy。东方财富部分基金无 pingzhongdata
 * 数据时会 301 重定向到 notfound.html，此时脚本 onload 后无对应全局变量，
 * 返回空对象由调用方回退。
 */

// ── 东方财富代理（Cloudflare Worker，可选）─────────
// 本地网络（含代理）无法访问 *.eastmoney.com 时，配置此 Worker URL，由部署在
// Cloudflare 边缘的 Worker 服务端请求东财并转发，绕开本地网络阻断。
// 未配置时回退为直连东财（仅在本地网络可达东财时可用，如开发机挂着可用代理）。
const FUND_WORKER_URL: string | undefined = (import.meta.env as any).VITE_FUND_WORKER_URL
const EM_BASE = FUND_WORKER_URL || 'https://fund.eastmoney.com'
const FUNDGZ_BASE = FUND_WORKER_URL || 'https://fundgz.1234567.com.cn'
const FUNDSUGGEST_BASE = FUND_WORKER_URL || 'https://fundsuggest.eastmoney.com'

// ── JSONP 回调 ─────────────────────────────────────
type Resolver = (data: any) => void
const pending = new Map<string, Resolver>()

function ensureGlobalCallback() {
  if ((window as any).__jsonpgzRegistered) return
  ;(window as any).__jsonpgzRegistered = true
  const old = (window as any).jsonpgz
  ;(window as any).jsonpgz = (data: any) => {
    if (old) old(data)
    const code = data?.fundcode
    if (code && pending.has(code)) {
      pending.get(code)!(data)
      pending.delete(code)
    }
  }
}

function loadJsonp(code: string, timeout: number): Promise<any> {
  return new Promise((resolve, reject) => {
    ensureGlobalCallback()
    pending.set(code, resolve)
    const el = document.createElement('script')
    el.src = `${FUNDGZ_BASE}/js/${code}.js?rt=${Date.now()}`
    el.onerror = () => { pending.delete(code); reject(new Error('JSONP 加载失败')) }
    document.head.appendChild(el)
    setTimeout(() => {
      if (pending.has(code)) { pending.delete(code); reject(new Error('JSONP 超时')) }
    }, timeout)
  })
}

// ── 公开 API ─────────────────────────────────────

/**
 * 获取基金实时估算净值（JSONP，<script> 标签加载，跨域无 CORS 问题）。
 */
export async function fetchFundGzJsonp(code: string, timeout = 10000): Promise<any> {
  return loadJsonp(code, timeout)
}

/**
 * 获取基金历史数据（净值走势、持仓等）。用 <script> 标签（JSONP）加载，跨域无 CORS 问题。
 */

/** 用 <script> 标签加载 pingzhongdata（绝对地址，跨域无 CORS 问题） */
function loadPingZhongData(code: string, timeout: number): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `${EM_BASE}/pingzhongdata/${code}.js?v=${Date.now()}`
    el.onload = () => {
      const result: Record<string, any> = {}
      const known = [
        'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_assetAllocation',
        'Data_fundSharesPositions', 'Data_fluctuationScale',
        'Data_holderStructure', 'Data_rateInSimilarPersent',
        'Data_rateInSimilarType', 'Data_buySedemption',
        'Data_currentFundManager', 'Data_performanceEvaluation',
        'fS_name', 'fS_code', 'stockCodes', 'stockCodesNew',
        'fund_Rate', 'fund_minsg', 'syl_', 'zqCodes',
      ]
      for (const v of known) {
        if ((window as any)[v] !== undefined) result[v] = (window as any)[v]
      }
      known.forEach((v) => { (window as any)[v] = undefined })
      el.remove()
      resolve(result)
    }
    el.onerror = () => { el.remove(); reject(new Error('pingzhongdata 加载失败')) }
    document.head.appendChild(el)
    setTimeout(() => {
      if (document.head.contains(el)) {
        el.remove()
        reject(new Error('pingzhongdata 超时'))
      }
    }, timeout)
  })
}

export async function fetchFundPingZhongData(code: string, timeout = 15000): Promise<Record<string, any>> {
  // 始终用 <script> 标签（JSONP）加载：跨域无 CORS 问题，开发与生产行为一致。
  // 东方财富部分基金代码无 pingzhongdata 数据，会 301 重定向到 notfound.html；
  // 此时脚本 onload 后无对应全局变量，返回空对象，由调用方回退。
  return loadPingZhongData(code, timeout)
}

type FundHoldingsF10 = { date: string; holdings: { code: string; name: string; ratio: number }[] }

/** 解析 fundf10 持仓明细 raw JS 文本（`var apidata={content:"...",...}`），返回前十大重仓股。 */
function parseFundHoldingsF10(text: string): FundHoldingsF10 | null {
  // 提取 apidata 的 content 字符串（处理 JS 字符串转义）
  const contentMatch = text.match(/content:\s*"((?:\\.|[^"\\])*)"/s)
  if (!contentMatch) return null
  const content = contentMatch[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
  // 提取报告截止日期
  let date = ''
  const dateMatch = content.match(/截止至[：:]\s*(?:<[^>]*>)?(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) date = dateMatch[1]
  const holdings: { code: string; name: string; ratio: number }[] = []
  // 匹配 table 中的每一行：序号 + 代码 + 名称 + ...占净值比例%
  const regex = /<tr>\s*<td>(\d+)<\/td><td><a[^>]*>(\d{5,6})<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>(\d+\.\d+)%/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    if (holdings.length >= 10) break
    const name = m[3].trim()
    if (!name) continue
    holdings.push({ code: m[2], name, ratio: parseFloat(m[4]) })
  }
  return holdings.length > 0 ? { date, holdings } : null
}

/**
 * 从天天基金 F10 获取基金前十大重仓股明细（含占净值比例）。
 *
 * ⚠️ 特殊限制：`FundArchivesDatas.aspx` **强制校验 Referer 必须是 *.eastmoney.com**（实测：
 * 无 Referer / 跨域 Referer 一律 404），且无 CORS 头、无 JSONP callback。浏览器 JS **无法伪造
 * 跨域 Referer**，故 `<script>`/`fetch` 均无法在纯前端直取。唯一出路是**服务端代理设置 Referer**：
 *  - 开发环境：走 Vite dev proxy（`vite.config.ts` 的 `/fundf10`，已注入 eastmoney Referer）。
 *  - 生产环境（纯静态如 GitHub Pages）：无代理 → 返回 null 由调用方优雅降级；
 *    如需生产可用，须部署边缘代理（Cloudflare Worker 等）设置 Referer 转发。
 */
export async function fetchFundHoldingsF10(code: string, _timeout = 15000): Promise<FundHoldingsF10 | null> {
  try {
    if (import.meta.env.DEV) {
      // 开发环境：走 Vite dev proxy（vite.config.ts 的 /fundf10，已注入 eastmoney Referer）
      const res = await fetch(`/fundf10/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`)
      if (res.ok) return parseFundHoldingsF10(await res.text())
    } else if (FUND_WORKER_URL) {
      // 生产环境：走 Cloudflare Worker 代理（注入 eastmoney Referer），避免本地网络对东财的阻断
      const res = await fetch(`${FUND_WORKER_URL}/fundf10/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`)
      if (res.ok) return parseFundHoldingsF10(await res.text())
    }
  } catch {
    // Worker 不可用 / 东财不可达 → 落到降级
  }
  // 生产环境未配置 Worker：fundf10 需 eastmoney Referer，纯前端无法伪造 → 返回 null 让调用方回退
  return null
}

/**
 * 通过基金名称/关键词反查 6 位基金代码（东方财富基金搜索 JSONP）。
 *
 * 用途：截图导入（京东金融/支付宝等）识别出的持仓往往只有名称、没有代码，
 * 导入后无法获取行情。此函数按名称反查真实代码，使持仓可用（行情/K线/收益）。
 *
 * 接口：fundsuggest.eastmoney.com（支持 callback 参数，JSONP 跨域可用）。
 * 返回第一个匹配结果 { code, name }，无匹配或失败返回 null。
 */
export async function fetchFundCodeByName(name: string, timeout = 10000): Promise<{ code: string; name: string } | null> {
  const keyword = (name || '').trim()
  if (keyword.length < 2) return null
  return new Promise((resolve) => {
    const cbName = `__fundSuggestCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const script = document.createElement('script')
    const cleanup = () => {
      try { delete (window as any)[cbName] } catch { /* ignore */ }
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    ;(window as any)[cbName] = (data: any) => {
      cleanup()
      try {
        const datas: any[] = data?.Datas || []
        if (datas.length > 0) {
          // 优先取与关键词互相包含（最相似）的结果，否则取第一条
          const hit = datas.find((d) =>
            d.NAME && (d.NAME.includes(keyword) || keyword.includes(d.NAME)),
          ) || datas[0]
          if (hit?.CODE) {
            resolve({ code: String(hit.CODE), name: String(hit.NAME || keyword) })
            return
          }
        }
      } catch { /* ignore */ }
      resolve(null)
    }
    script.onerror = () => { cleanup(); resolve(null) }
    script.src = `${FUNDSUGGEST_BASE}/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}&callback=${cbName}&_=${Date.now()}`
    document.head.appendChild(script)
    setTimeout(() => { cleanup(); resolve(null) }, timeout)
  })
}
