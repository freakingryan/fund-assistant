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
