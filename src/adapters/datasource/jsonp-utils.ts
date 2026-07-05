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
  const isDev = typeof window !== 'undefined' && 
    (!!window.location.port && window.location.port !== '8080') &&
    // 额外检查：确保不是在 file:// 协议下
    window.location.protocol !== 'file:'
  
  console.log(`[isViteDev] 判断结果: ${isDev}, port=${window.location.port}, protocol=${window.location.protocol}`)
  return isDev
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
  console.log(`[fetchFundGzJsonp] 开始获取基金 ${code} 的实时净值`)
  console.log(`[fetchFundGzJsonp] 当前环境: ${isViteDev() ? 'Vite开发环境' : '生产环境'}`)
  
  if (isViteDev()) {
    // 开发环境：通过 Vite proxy 用 fetch 获取（同源，无 CORS）
    try {
      const url = `/fundgz/js/${code}.js?rt=${Date.now()}`
      console.log(`[fetchFundGzJsonp] [开发环境] 正在请求: ${url}`)
      
      const res = await fetch(url)
      console.log(`[fetchFundGzJsonp] 响应状态: ${res.status} ${res.statusText}`)
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      
      const text = await res.text()
      console.log(`[fetchFundGzJsonp] 响应文本长度: ${text.length} 字符`)
      console.log(`[fetchFundGzJsonp] 响应文本前100字符: ${text.substring(0, 100)}`)
      
      const data = parseGzJsonp(text)
      console.log(`[fetchFundGzJsonp] 解析后的数据:`, data)
      
      if (!data || data.fundcode !== code) {
        console.error(`[fetchFundGzJsonp] 数据解析失败或基金代码不匹配: 期望 ${code}, 实际 ${data?.fundcode}`)
        throw new Error('数据解析失败')
      }
      
      console.log(`[fetchFundGzJsonp] ✅ 成功获取基金 ${code} 实时净值: gsz=${data.gsz}, gszzl=${data.gszzl}`)
      return data
    } catch (error) {
      console.error(`[fetchFundGzJsonp] ❌ 获取失败:`, error)
      throw error
    }
  }
  
  // 生产环境：用 JSONP 方式加载
  console.log(`[fetchFundGzJsonp] [生产环境] 使用 JSONP 方式加载`)
  return loadJsonp(code, timeout)
}

/**
 * 获取基金历史数据（净值走势、持仓等）。
 * 优先走 Vite proxy，降级到 <script> 标签加载。
 */
export async function fetchFundPingZhongData(code: string, timeout = 15000): Promise<Record<string, any>> {
  console.log(`[fetchFundPingZhongData] 开始获取基金 ${code} 的历史数据`)
  console.log(`[fetchFundPingZhongData] 当前环境: ${isViteDev() ? 'Vite开发环境' : '生产环境'}`)
  
  if (isViteDev()) {
    // 开发环境：通过 Vite proxy 获取
    try {
      const url = `/pingzhongdata/pingzhongdata/${code}.js?v=${Date.now()}`
      console.log(`[fetchFundPingZhongData] [开发环境] 正在请求: ${url}`)
      
      const res = await fetch(url)
      console.log(`[fetchFundPingZhongData] 响应状态: ${res.status} ${res.statusText}`)
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      
      const text = await res.text()
      console.log(`[fetchFundPingZhongData] 响应文本长度: ${text.length} 字符`)
      console.log(`[fetchFundPingZhongData] 响应文本前200字符: ${text.substring(0, 200)}`)
      
      // 用正则提取已知的全局变量赋值
      const vars: Record<string, any> = {}
      const extractVar = (name: string) => {
        // 匹配 var name = [...] 或 var name = {...}
        const re = new RegExp(`var ${name}\\s*=\\s*(\\[.+?\\]|\\{.+?\\});`, 's')
        const m = text.match(re)
        if (m) {
          try { 
            vars[name] = JSON.parse(m[1]) 
            console.log(`[fetchFundPingZhongData] ✅ 成功提取变量 ${name}`)
          } catch { 
            console.warn(`[fetchFundPingZhongData] ⚠️ 变量 ${name} JSON解析失败`)
          }
        } else {
          console.log(`[fetchFundPingZhongData] ⚠️ 未找到变量 ${name}`)
        }
      }
      
      const variablesToExtract = [
        'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_assetAllocation',
        'Data_fundSharesPositions', 'Data_fluctuationScale', 'Data_holderStructure',
        'Data_currentFundManager', 'Data_buySedemption', 'Data_performanceEvaluation',
        'fS_name', 'fS_code', 'stockCodes', 'stockCodesNew',
      ]
      
      console.log(`[fetchFundPingZhongData] 开始提取 ${variablesToExtract.length} 个变量...`)
      variablesToExtract.forEach(extractVar)
      
      console.log(`[fetchFundPingZhongData] ✅ 成功获取基金 ${code} 历史数据:`, Object.keys(vars))
      return vars
    } catch (error) {
      console.error(`[fetchFundPingZhongData] ❌ 获取失败:`, error)
      throw error
    }
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
