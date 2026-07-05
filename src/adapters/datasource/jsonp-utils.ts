/**
 * JSONP 工具模块（共享给 stock-api 和 eastmoney 适配器）
 *
 * fundgz.1234567.com.cn 返回 JSONP 格式：jsonpgz({ fundcode, ... })
 * fund.eastmoney.com/pingzhongdata/{code}.js 通过 <script> 加载设置全局变量
 * 浏览器必须用 <script> 标签加载（不支持 CORS），该模块提供统一支持。
 */

type Resolver = (data: any) => void

// 按 fundcode 分派的 pending 请求
const pending = new Map<string, Resolver>()

// pingzhongdata 脚本加载完成的回调
type PingZhongResolver = (vars: Record<string, any>) => void
const pingZhongPending = new Map<string, PingZhongResolver>()

/**
 * 确保全局 jsonpgz 回调已注册。
 * 多次调用安全，只会注册一次。
 */
function ensureGlobalCallback() {
  if ((window as any).__jsonpgzRegistered) return
  ;(window as any).__jsonpgzRegistered = true

  // 备份旧的 jsonpgz（如果有其他库已经注册）
  const old = (window as any).jsonpgz

  ;(window as any).jsonpgz = (data: any) => {
    // 通知旧的回调
    if (old) old(data)

    // 按 fundcode 分派
    const code = data?.fundcode
    if (code && pending.has(code)) {
      pending.get(code)!(data)
      pending.delete(code)
    }
  }
}

/**
 * 通过 JSONP 加载 fundgz.1234567.com.cn 的基金实时估算净值。
 * @param code 基金代码，如 021533
 * @param timeout 超时毫秒数，默认 10000
 * @returns JSONP 响应数据（fundcode, name, dwjz, gsz, gszzl, jzrq, gztime）
 */
export function fetchFundGzJsonp(code: string, timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    ensureGlobalCallback()
    pending.set(code, resolve)

    const el = document.createElement('script')
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`
    el.src = url
    el.onerror = () => {
      pending.delete(code)
      reject(new Error(`JSONP 加载失败: ${url}`))
    }
    document.head.appendChild(el)

    setTimeout(() => {
      if (pending.has(code)) {
        pending.delete(code)
        reject(new Error(`JSONP 超时: ${code}`))
      }
    }, timeout)
  })
}

/**
 * 通过 <script> 加载 fund.eastmoney.com/pingzhongdata/{code}.js
 * 该 JS 文件包含基金的历史净值、持仓等数据，无需执行 JS 引擎。
 * 脚本加载后会自动设置全局变量，我们通过轮询方式读取。
 *
 * @param code 基金代码
 * @param timeout 超时毫秒数，默认 15000
 * @returns 包含基金数据的对象（Data_netWorthTrend, Data_ACWorthTrend 等）
 */
export function fetchFundPingZhongData(code: string, timeout = 15000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`
    el.src = url

    // 脚本加载后，全局变量会被设置，轮询读取
    el.onload = () => {
      const vars: Record<string, any> = {}
      // 尝试读取已知的全局变量
      const knownVars = [
        'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_assetAllocation',
        'Data_fundSharesPositions', 'Data_fluctuationScale',
        'Data_holderStructure', 'Data_rateInSimilarPersent',
        'Data_rateInSimilarType', 'Data_buySedemption',
        'Data_currentFundManager', 'Data_performanceEvaluation',
        'fS_name', 'fS_code', 'stockCodes', 'stockCodesNew',
        'fund_Rate', 'fund_minsg', 'syl_', 'zqCodes',
      ]
      for (const v of knownVars) {
        if ((window as any)[v] !== undefined) {
          vars[v] = (window as any)[v]
        }
      }
      // 清理全局变量（var 声明的属性不可 delete，设为 undefined）
      knownVars.forEach((v) => { (window as any)[v] = undefined })
      // 移除 script 元素
      el.remove()
      resolve(vars)
    }

    el.onerror = () => {
      el.remove()
      reject(new Error(`pingzhongdata 加载失败: ${url}`))
    }

    document.head.appendChild(el)

    setTimeout(() => {
      // 超时清理
      if (document.head.contains(el)) {
        el.remove()
        const knownVars = [
          'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_assetAllocation',
          'Data_fundSharesPositions', 'Data_fluctuationScale',
          'Data_holderStructure', 'fS_name',
        ]
        knownVars.forEach((v) => { (window as any)[v] = undefined })
        reject(new Error(`pingzhongdata 超时: ${code}`))
      }
    }, timeout)
  })
}
