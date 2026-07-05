/**
 * 测试 stock-api 获取股票名称和重仓股数据
 */
import { stocks } from 'stock-api'

async function test() {
  // 1. 测试 stock-api getStock 对不同格式代码的支持
  const testCodes = ['SH600519', 'SZ000858', 'HK01179', '600519', '000858']
  console.log('=== 测试 stock-api getStock ===')
  for (const code of testCodes) {
    try {
      const stock = await stocks.auto.getStock(code)
      console.log(`getStock("${code}") → ${stock?.name || 'null'} (code: ${stock?.code || 'null'})`)
    } catch (e) {
      console.log(`getStock("${code}") → ERROR: ${e.message}`)
    }
  }

  // 2. 模拟 fetchFundPortfolio 中的逻辑
  console.log('\n=== 模拟 fetchFundPortfolio ===')
  const rawStockCodesNew = ["1.600519","0.000858","0.000568","116.01179","116.00700","1.600809","116.09988","116.00883","0.002027","116.09987"]
  
  // 解析格式
  const rawCodes = rawStockCodesNew.map(c => {
    const parts = c.split('.')
    return { market: parts[0], code: parts[1] }
  })
  
  // 转换为 stock-api 格式
  const apiCodes = rawCodes.map(r => {
    if (r.market === '1') return `SH${r.code}`
    if (r.market === '0') return `SZ${r.code}`
    if (r.market === '116') return `HK${r.code}`
    return r.code
  })
  console.log('API codes:', apiCodes)
  
  // 并发查询
  const results = await Promise.allSettled(
    apiCodes.map(code => stocks.auto.getStock(code))
  )
  
  console.log('\n查询结果:')
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.name) {
      console.log(`  ✅ ${rawCodes[i].code} → ${r.value.name}`)
    } else if (r.status === 'fulfilled') {
      console.log(`  ❌ ${rawCodes[i].code} → no name (value: ${JSON.stringify(r.value)})`)
    } else {
      console.log(`  ❌ ${rawCodes[i].code} → ${r.reason?.message || 'error'}`)
    }
  })
}

test().catch(console.error)
