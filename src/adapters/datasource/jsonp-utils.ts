/**
 * JSONP 工具模块（共享给 stock-api 和 eastmoney 适配器）
 *
 * fundgz.1234567.com.cn 返回 JSONP 格式：jsonpgz({ fundcode, ... })
 * 浏览器必须用 <script> 标签加载（不支持 CORS），该模块提供统一支持。
 */

type Resolver = (data: any) => void

// 按 fundcode 分派的 pending 请求
const pending = new Map<string, Resolver>()

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
