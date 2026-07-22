/**
 * 腾讯 K 线浏览器安全抓取。
 *
 * 端点说明（重要）：
 *  - 旧端点 `web.ifzq.gtimg.cn/appstock/app/fqkline/get` 已被腾讯 WAF 拦截，
 *    返回 501 并重定向到 waf 页，浏览器裸 fetch / Vite 代理均失败（表现为 CORS 报错）。
 *  - 现改用 `proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get`：
 *    该端点返回 `Access-Control-Allow-Origin: *`，浏览器可直接 `fetch`，
 *    开发态 / 生产态均无需代理或 JSONP（<script> 注入），最简洁稳健。
 *  - 返回结构：data.<code>.day = [[date, open, close, high, low, volume], ...]。
 */
import type { KLineData } from '@/types'

/** 可用端点基址（自带 CORS *，浏览器直连） */
const TENCENT_KLINE_BASE = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app'

/**
 * 腾讯代码格式：小写市场前缀（sh/sz/bj）+ 6 位代码。
 * 接口返回的 data 键也是小写（如 data.sz159363），故统一小写，避免解析错位。
 */
function toTencentCode(rawCode: string): string {
  const code = rawCode.replace(/^(sh|sz|bj)/i, '').trim()
  if (!/^\d{6}$/.test(code)) return rawCode.toLowerCase()
  let prefix = 'sh'
  if (/^(51|56|58)/.test(code) || /^[69]/.test(code)) prefix = 'sh'
  else if (/^(15|16)/.test(code) || /^[032]/.test(code)) prefix = 'sz'
  else if (/^[48]/.test(code)) prefix = 'bj'
  return `${prefix}${code}`
}

function buildUrl(code: string, count: number, adjust: 'qfq' | 'none'): string {
  const endpoint = adjust === 'none' ? 'kline/kline' : 'fqkline/get'
  const adjustParam = adjust === 'none' ? '' : `,${adjust}`
  return `${TENCENT_KLINE_BASE}/${endpoint}?param=${code},day,,,${count}${adjustParam}`
}

function parse(text: string, code: string): KLineData[] {
  try {
    const json = JSON.parse(text)
    const node = json?.data?.[code]
    if (!node) return []
    const rows: unknown[] = node.qfqday || node.day || []
    return rows.map((r) => {
      const row = r as [string, number, number, number, number, number]
      return {
        date: String(row[0]),
        open: Number(row[1] || 0),
        close: Number(row[2] || 0),
        high: Number(row[3] || 0),
        low: Number(row[4] || 0),
        volume: Number(row[5] || 0),
      }
    })
  } catch {
    return []
  }
}

/**
 * 浏览器安全的腾讯 K 线抓取（绕开 WAF + 直连 CORS*）。
 * @param rawCode 任意格式基金/ETF/个股代码
 * @param count 返回根数（日 K）
 * @param adjust 复权方式，默认 qfq（前复权）
 */
export async function fetchTencentKline(
  rawCode: string,
  count: number,
  adjust: 'qfq' | 'none' = 'qfq',
): Promise<KLineData[]> {
  const code = toTencentCode(rawCode)
  if (!/^(sh|sz|bj)\d{6}$/.test(code)) return []
  const url = buildUrl(code, count, adjust)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      console.warn('[tencentKline] 接口返回', res.status, code)
      return []
    }
    return parse(await res.text(), code)
  } catch (e) {
    // 网络/CORS/超时：优雅降级为空数组，避免控制台大量报错
    console.warn('[tencentKline] 获取失败', code, (e as Error)?.message ?? e)
    return []
  } finally {
    clearTimeout(timer)
  }
}
