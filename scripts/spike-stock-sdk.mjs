// P0 可行性验证 spike：验证 stock-sdk 在 Node 环境下的取数能力与返回结构。
// 仅用于验证，不参与构建。运行：node scripts/spike-stock-sdk.mjs
import StockSDK from 'stock-sdk'

const sdk = new StockSDK()
const out = {}

async function tryStep(name, fn) {
  try {
    const r = await fn()
    out[name] = { ok: true, sample: summarize(r) }
  } catch (e) {
    out[name] = { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

function summarize(r) {
  if (Array.isArray(r)) {
    return { type: 'array', len: r.length, first: r[0] ? JSON.stringify(r[0]).slice(0, 200) : null }
  }
  if (r && typeof r === 'object') {
    const keys = Object.keys(r)
    // 取前几个字段的样本
    const sample = {}
    for (const k of keys.slice(0, 8)) {
      const v = r[k]
      sample[k] = typeof v === 'object' ? (Array.isArray(v) ? `[array ${v.length}]` : '{obj}') : v
    }
    return { type: 'object', keys, sample }
  }
  return { type: typeof r, value: String(r).slice(0, 100) }
}

await tryStep('kline.cn(daily, sh510300)', () =>
  sdk.kline.cn('sh510300', { period: 'daily', adjust: 'qfq' })
)
await tryStep('fund.navHistory(000001)', () => sdk.fund.navHistory('000001'))
await tryStep('fund.estimate(000001)', () => sdk.fund.estimate('000001'))
await tryStep('quotes.fund([000001,510300])', () =>
  sdk.quotes.fund(['000001', '510300'])
)
await tryStep('search(沪深300)', () => sdk.search('沪深300'))
await tryStep('fund.profile(000001)', () => sdk.fund.profile('000001'))

console.log(JSON.stringify(out, null, 2))
