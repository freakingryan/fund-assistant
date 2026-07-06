/**
 * 数据获取工具模块
 *
 * fundgz.1234567.com.cn — 基金实时估算净值（JSONP，无 CORS）
 * fund.eastmoney.com/pingzhongdata — 基金历史数据（JS，无 CORS）
 *
 * 策略：
 * 1. Vite dev server 下：通过 Vite proxy（/fundgz, /pingzhongdata）用 fetch 获取，
 *    同源请求无 CORS 问题。
 * 2. 生产环境（GitHub Pages）/Vite proxy 不可用时：用 <script> 标签（JSONP）加载。
 */

// ── 工具函数 ─────────────────────────────────────

/** 判断是否在 Vite dev server 下运行（可通过 proxy 走 fetch） */
function isViteDev(): boolean {
  return typeof window !== 'undefined' && 
    (!!window.location.port && window.location.port !== '8080') &&
    window.location.protocol !== 'file:'
}

/** 解析 fundgz JSONP 响应文本 {@code jsonpgz({...})} */
function parseGzJsonp(text: string): any {
  const m = text.trim().match(/^jsonpgz\((.+)\);?\s*$/)
  return m ? JSON.parse(m[1]) : null
}

// ── JSONP 回调（生产环境降级） ──────────────────────
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
    el.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`
    el.onerror = () => { pending.delete(code); reject(new Error('JSONP 加载失败')) }
    document.head.appendChild(el)
    setTimeout(() => {
      if (pending.has(code)) { pending.delete(code); reject(new Error('JSONP 超时')) }
    }, timeout)
  })
}

// ── 公开 API ─────────────────────────────────────

/**
 * 获取基金实时估算净值。
 * 优先走 Vite proxy（开发环境），降级到 JSONP（生产环境）。
 */
export async function fetchFundGzJsonp(code: string, timeout = 10000): Promise<any> {
  if (isViteDev()) {
    // 开发环境：通过 Vite proxy 用 fetch 获取（同源，无 CORS）
    const res = await fetch(`/fundgz/js/${code}.js?rt=${Date.now()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const data = parseGzJsonp(text)
    if (!data || data.fundcode !== code) throw new Error('数据解析失败')
    return data
  }
  // 生产环境：用 JSONP 方式加载
  return loadJsonp(code, timeout)
}

/**
 * 获取基金历史数据（净值走势、持仓等）。
 * 优先走 Vite proxy，降级到 <script> 标签加载。
 */
export async function fetchFundPingZhongData(code: string, timeout = 15000): Promise<Record<string, any>> {
  if (isViteDev()) {
    // 开发环境：通过 Vite proxy 获取
    const res = await fetch(`/pingzhongdata/pingzhongdata/${code}.js?v=${Date.now()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    // 用正则提取已知的全局变量赋值
    const vars: Record<string, any> = {}
    const extractVar = (name: string) => {
      const re = new RegExp(`var ${name}\\s*=\\s*(\\[.+?\\]|\\{.+?\\});`, 's')
      const m = text.match(re)
      if (m) {
        try { vars[name] = JSON.parse(m[1]) } catch { /* skip */ }
      }
    }
    ;[
      'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_assetAllocation',
      'Data_fundSharesPositions', 'Data_fluctuationScale', 'Data_holderStructure',
      'Data_currentFundManager', 'Data_buySedemption', 'Data_performanceEvaluation',
      'fS_name', 'fS_code', 'stockCodes', 'stockCodesNew',
    ].forEach(extractVar)
    return vars
  }

  // 生产环境：用 <script> 标签加载
  const vars: Record<string, any> = await new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`
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
  return vars
}

/** 解析 fundf10 持仓明细 HTML 内容，返回前十大重仓股（含占净值比例） */
function parseFundHoldingsF10(text: string): { date: string; holdings: { code: string; name: string; ratio: number }[] } | null {
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
 * 开发环境走 Vite proxy，生产环境暂返回 null（由调用方回退）。
 */
export async function fetchFundHoldingsF10(code: string, _timeout = 15000): Promise<{ date: string; holdings: { code: string; name: string; ratio: number }[] } | null> {
  if (isViteDev()) {
    const res = await fetch(`/fundf10/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return parseFundHoldingsF10(text)
  }
  // 生产环境：fundf10 暂不支持 CORS 且无 JSONP callback，返回 null 让调用方回退
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
    script.src = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}&callback=${cbName}&_=${Date.now()}`
    document.head.appendChild(script)
    setTimeout(() => { cleanup(); resolve(null) }, timeout)
  })
}
