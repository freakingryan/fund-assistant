/**
 * stock-api 数据源适配器（迁移中：仅保留非 K 线能力）
 *
 * 直接在前端浏览器中调用腾讯/新浪/东方财富的行情接口，无需后端服务。
 * 安装：npm install stock-api
 * 文档：https://github.com/zhangxiangliang/stock-api
 *
 * 注意：场内 ETF / 个股真实 K 线已迁移至 stock-sdk 适配器（见 stockSdkAdapter.ts，
 * 经 `sdk.kline.cn` 直连东财 push2his，自带重试/限流/熔断/CDN 兜底）。
 * 本适配器现仅承担：场外基金净值走势（pingzhongdata）、实时估值（fundgz）、
 * 个股行情、F10 重仓股、ETF 映射搜索等——将在 P2~P4 逐步替换为 stock-sdk 原生实现，
 * 最终于 P5 删除本文件。
 *
 * 代码格式：SH510500（沪市）、SZ159558（深市）、HK02020（港股）、USDJI（美股）
 */
import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { fetchFundGzJsonp, fetchFundPingZhongData, fetchFundHoldingsF10 } from './jsonp-utils'
import StockApiDefault from 'stock-api'

// stock-api 的 getStocks 运行时可能额外返回 amount（成交额），此处补声明。
// stock-api 默认导出为运行时值，故用 `typeof` 取其类型（仅类型位置使用，运行时由下方动态 import 提供）。
type StockApiModule = typeof StockApiDefault['stocks']
type StockResult = Awaited<ReturnType<StockApiModule['auto']['getStocks']>>[number]
type StockWithAmount = StockResult & { amount?: number }

// stock-api 是 ESM-only 库，动态 import 以适应项目构建配置
let stocks: StockApiModule | null = null

async function ensureStocks(): Promise<StockApiModule> {
  if (!stocks) {
    // stock-api 已在模块顶部静态导入（其默认导出含运行时 stocks 对象），直接取实例即可，
    // 避免「静态 + 动态」混用导致的无效动态导入警告（stock-api.ts 本身已被主包引入）。
    stocks = StockApiDefault.stocks
  }
  return stocks!
}

// 请求间隔，避免对东方财富/新浪/腾讯搜索接口连发触发限流（429）
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── 搜索兜底：东方财富基金搜索（JSONP，跨域可用，返回基金/ETF） ──
function jsonpOnce(url: string, cbName: string, timeout: number): Promise<any> {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    const cleanup = () => {
      try { delete (window as any)[cbName] } catch { /* ignore */ }
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    ;(window as any)[cbName] = (data: any) => { cleanup(); resolve(data) }
    script.onerror = () => { cleanup(); resolve(null) }
    script.src = url
    document.head.appendChild(script)
    setTimeout(() => { cleanup(); resolve(null) }, timeout)
  })
}

// ── K 线请求防护已迁移至 stock-sdk（自带重试/限流/熔断/CDN 兜底），此处不再自维护 ──

async function searchStocksEastmoney(key: string): Promise<{ code: string; name: string }[]> {
  const keyword = (key || '').trim()
  if (keyword.length < 2) return []
  const cbName = `__emSearchCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}&callback=${cbName}&_=${Date.now()}`
  const data = await jsonpOnce(url, cbName, 8000)
  const datas: any[] = data?.Datas || []
  return datas
    .map((d: any) => ({ code: String(d.CODE || ''), name: String(d.NAME || '') }))
    .filter((d: any) => d.code && d.name)
}

// 稳健搜索：合并 stock-api 与东方财富（CORS 安全、按全名索引基金与 ETF）的结果，最大化候选覆盖
async function searchStocksRobust(key: string): Promise<{ code: string; name: string }[]> {
  const out = new Map<string, { code: string; name: string }>()
  const push = (list: { code: string; name: string }[]) => {
    for (const r of list) {
      const c = (r.code || '').replace(/^(SZ|SH)/, '')
      if (c && r.name) out.set(c, { code: c, name: r.name })
    }
  }
  try {
    const s = await ensureStocks()
    const results = await s.auto.searchStocks(key)
    if (results && results.length) push(results as { code: string; name: string }[])
  } catch { /* ignore */ }
  try {
    const em = await searchStocksEastmoney(key)
    if (em.length) push(em)
  } catch { /* ignore */ }
  return [...out.values()]
}

/**
 * 将场内 ETF/LOF 代码转换为 stock-api 格式（带市场前缀）
 * 159xxx/16xxxx → SZ159xxx/SZ16xxxx（深交所）
 * 51xxxx/56xxxx/58xxxx → SH51xxxx/SH56xxxx/SH58xxxx（上交所）
 * 其他原样返回
 *
 * 注意：此函数与 toStockApiCode 刻意分开——两者覆盖不同的代码空间。
 * toApiCode 仅处理 ETF/LOF 前缀（159/16/51/56/58），不识别个股代码（如 159915
 * 必须加 SZ 前缀，而个股规则不会给 1 开头加前缀）；toStockApiCode 处理个股
 * 6/9/0/3/2/8/4/5 并放行已带 SH/SZ/BJ/HK/US 前缀的代码。二者不可合并。
 */
function toApiCode(code: string): string {
  if (code.startsWith('159') || code.startsWith('16')) return `SZ${code}`
  if (code.startsWith('51') || code.startsWith('56') || code.startsWith('58')) return `SH${code}`
  return code
}

/** 判断是否为场内 ETF/LOF 代码 */
function isExchangeCode(code: string): boolean {
  return code.startsWith('159') || code.startsWith('51') || code.startsWith('56') || code.startsWith('58') || code.startsWith('16')
}

/**
 * 将普通 6 位股票代码转换为 stock-api 格式（带市场前缀）
 * 6xxxxx/9xxxxx → SH（沪市主板/科创板）
 * 0xxxxx/3xxxxx/2xxxxx → SZ（深市/创业板）
 * 8xxxxx/4xxxxx → BJ（北交所）
 * 已带 SH/SZ/BJ/HK/US 前缀的原样返回
 */
function toStockApiCode(code: string): string {
  if (/^(SH|SZ|BJ|HK|US)/i.test(code)) return code
  if (/^\d{4,6}$/.test(code)) {
    const f = code[0]
    if (f === '6' || f === '9') return `SH${code}`
    if (f === '0' || f === '3' || f === '2') return `SZ${code}`
    if (f === '8' || f === '4') return `BJ${code}`
    if (f === '5') return `SH${code}`
  }
  return code
}

/**
 * 获取场外基金实时估值 / 最新净值。
 *
 * 数据源：
 * - 优先：fundgz.1234567.com.cn 盘中估算净值（实时，交易时段内有值）
 * - 兜底：fund.eastmoney.com/pingzhongdata 最新单位净值（适用于无盘中估值的基金，
 *   如货币基金、券商资管 98xxxx、部分 QDII / 定开基金）
 *
 * 说明：许多场外基金并未在天天基金发布盘中估值，fundgz 会稳定返回 404，
 * 这是**预期场景**而非异常，因此任一来源失败均静默降级，不向控制台刷错误日志。
 */
async function fetchFundGzQuote(code: string): Promise<FundQuote | null> {
  // 空码或非法码（截图导入常缺代码）直接返回，避免发请求
  if (!code || !/^\d{6}$/.test(code)) return null

  // 1) 优先：盘中估算净值（实时估值）
  try {
    const data = await fetchFundGzJsonp(code)
    if (data && data.fundcode === code) {
      const gsz = Number(data.gsz) || 0
      const dwjz = Number(data.dwjz) || 0
      return {
        code,
        name: String(data.name || code),
        nav: gsz > 0 ? gsz : dwjz,
        accNav: 0,
        dailyChange: Number(data.gszzl) || 0,
        navDate: String(data.gztime || data.jzrq || '').slice(0, 10),
      }
    }
  } catch {
    // 盘中估值不可用（404 / 超时），降级到最新净值
  }

  // 2) 兜底：最新单位净值（pingzhongdata 历史净值末值）
  try {
    const vars = await fetchFundPingZhongData(code)
    const trend: any[] = vars['Data_netWorthTrend']
    if (Array.isArray(trend) && trend.length > 0) {
      const last = trend[trend.length - 1]
      const prev = trend.length > 1 ? trend[trend.length - 2] : null
      const nav = Number(last.y) || 0
      const prevNav = prev ? Number(prev.y) || 0 : 0
      const dailyChange = prevNav > 0 ? ((nav - prevNav) / prevNav) * 100 : 0
      const navDate = last.x ? new Date(last.x).toISOString().slice(0, 10) : ''
      const name = String(vars['fS_name'] || code)
      if (nav > 0) {
        return { code, name, nav, accNav: 0, dailyChange, navDate }
      }
    }
  } catch {
    // 净值兜底也失败，静默返回 null
  }

  return null
}

/** 导出别名：带净值兜底，供导入时校验代码是否可正常获取行情 */
export const fetchFundQuoteWithFallback = fetchFundGzQuote

export class StockApiAdapter implements FundDataSource {
  name = 'stock-api'

  isConfigured(): boolean {
    return true // 纯前端库，始终可用
  }

  /**
   * 从字段名中提取：stock-api 返回的 Stock 接口
   * { code, name, now, low, high, percent, yesterday, source }
   */
  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    try {
      const s = await ensureStocks()
      const apiCode = toApiCode(code)
      const stock = await s.auto.getStock(apiCode)
      if (stock && stock.name) {
        const type = code.startsWith('159') || code.startsWith('51') ? '指数型' : '其他'
        return { name: stock.name, type }
      }
    } catch { /* fallback */ }
    return { name: code, type: '其他' }
  }

  /**
   * 获取实时行情
   * - 场内 ETF/股票 → stock-api（腾讯接口实时行情）
   * - 场外基金 → fundgz.1234567.com.cn（天天基金实时估算净值）
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    
    if (codes.length === 0) return []

    const etfCodes = codes.filter(isExchangeCode)
    const fundCodes = codes.filter((c) => !isExchangeCode(c) && /^\d{6}$/.test(c))
    const results: FundQuote[] = []


    // 1) 场内 ETF：通过 stock-api 获取实时行情
    if (etfCodes.length > 0) {
      try {
        const s = await ensureStocks()
        const apiCodes = etfCodes.map(toApiCode)
        const stocksList = await s.auto.getStocks(apiCodes)
        
        for (let i = 0; i < etfCodes.length; i++) {
          const stock = stocksList[i]
          if (stock && stock.now > 0 && stock.name) {
            results.push({
              code: etfCodes[i],
              name: stock.name,
              nav: stock.now,
              accNav: 0,
              dailyChange: stock.percent * 100,
              navDate: new Date().toISOString().slice(0, 10),
            })
          }
        }
      } catch (error) {
        console.error(`[StockApiAdapter.fetchQuotes] ❌ ETF行情获取失败:`, error)
        /* fallback to fundgz */
      }
    }

    // 2) 场外基金：通过 fundgz.1234567.com.cn 获取实时估算净值
    if (fundCodes.length > 0) {
      const fundQuotes = await Promise.allSettled(fundCodes.map(fetchFundGzQuote))
      
      
      for (let i = 0; i < fundCodes.length; i++) {
        const q = fundQuotes[i]
        if (q.status === 'fulfilled' && q.value) {
          results.push(q.value)
        }
      }
    }

    return results
  }

  /**
   * 净值走势 K 线（仅场外基金净值序列）。
   * 场内 ETF 真实 K 线已由 stock-sdk 适配器经 `sdk.kline.cn` 提供
   * （见 stockSdkAdapter.fetchEtfKLine），此处不再自行拉取场内 K 线。
   * - 场外基金 → fund.eastmoney.com/pingzhongdata/{code}.js（历史净值）
   */
  async fetchKLine(code: string, _period = '3m'): Promise<KLineData[]> {
    // 空码/非法码（截图导入常缺代码）无法获取走势，直接返回空
    if (!code || !/^\d{6}$/.test(code)) return []
    // 场内 ETF 真实 K 线由 stock-sdk 提供，此处仅处理场外净值序列
    if (isExchangeCode(code)) return []

    // 场外基金：从 pingzhongdata JS 获取净值走势
    try {
      const vars = await fetchFundPingZhongData(code)
      const trend = vars['Data_netWorthTrend']
      if (Array.isArray(trend) && trend.length > 0) {
        return trend.map((item: any) => {
          // JS 数据格式：{x: timestamp_ms, y: nav, equityReturn: change%}
          const ts = item.x
          const date = ts ? new Date(ts).toISOString().slice(0, 10) : ''
          const nav = Number(item.y) || 0
          return { date, open: nav, close: nav, high: nav, low: nav, volume: 0 }
        })
      }
    } catch (e) {
      console.warn(`[K线] 场外基金净值走势获取失败（将回退）: ${code}`, e)
    }
    return []
  }

  /**
   * 个股实时行情
   * 通过 stock-api 获取现价/涨跌幅，返回 FundQuote 兼容结构（nav=现价）
   */
  async fetchStockQuote(code: string): Promise<FundQuote | null> {
    try {
      const s = await ensureStocks()
      const apiCode = toStockApiCode(code)
      const stock = await s.auto.getStock(apiCode)
      if (stock && stock.name && stock.now > 0) {
        return {
          code,
          name: stock.name,
          nav: stock.now,
          accNav: 0,
          dailyChange: (stock.percent ?? 0) * 100,
          navDate: new Date().toISOString().slice(0, 10),
        }
      }
    } catch { /* fallback */ }
    return null
  }

  /**
   * 获取基金持仓明细（前十大重仓股）
   * 通过 fund.eastmoney.com/pingzhongdata/{code}.js 获取
   * 数据来源：Data_fundSharesPositions, stockCodes
   */
  async fetchFundPortfolio(fundCode: string): Promise<{
    date: string
    holdings: { code: string; name: string; ratio: number; value: number }[]
  } | null> {
    try {
      // 优先从 F10 获取带比例的持仓明细（开发环境可用 Vite proxy）
      const f10Result = await fetchFundHoldingsF10(fundCode)
      if (f10Result && f10Result.holdings.length > 0) {
        return {
          date: f10Result.date || '',
          holdings: f10Result.holdings.map((h) => ({ ...h, value: 0 })),
        }
      }

      // 回退：从 pingzhongdata 获取代码，再用 stock-api 查名称（比例无法获取，默认 0）
      const vars = await fetchFundPingZhongData(fundCode)

      // 从 stockCodesNew 获取前十大重仓股票代码（格式：["1.600519","0.000858","116.01179"]）
      // market: 1=SH, 0=SZ, 116=HK
      const rawStockCodesNew = vars['stockCodesNew']

      const rawCodes: { market: string; code: string }[] = (rawStockCodesNew || []).map((c: string) => {
        const parts = String(c).split('.')
        if (parts.length !== 2) return null
        return { market: parts[0], code: parts[1] }
      }).filter(Boolean)

      // 若新格式为空，回退旧格式（"6005191" → 去掉尾部市场标记）
      const codes: string[] = rawCodes.length > 0
        ? rawCodes.map((r: any) => {
            // 转换为 stock-api 兼容格式
            if (r.market === '1') return `SH${r.code}`
            if (r.market === '0') return `SZ${r.code}`
            if (r.market === '116') return `HK${r.code}`
            return r.code
          })
        : (vars['stockCodes'] || []).map((c: string) => String(c).replace(/\d$/, ''))

      if (codes.length === 0) { return null }

      // 并发获取股票名称（stock-api 的 getStock 按代码查询）
      const s = await ensureStocks()
      const results = await Promise.allSettled(
        codes.map((code: string) => s.auto.getStock(code))
      )

      const holdings = results
        .map((result: PromiseSettledResult<StockResult>, i: number) => {
          const raw = result.status === 'fulfilled' && result.value?.name
            ? { code: codes[i].replace(/^(SH|SZ|HK)/, ''), name: result.value.name, ratio: 0, value: 0 }
            : null
          if (raw && raw.name) return raw
          // 尝试从旧格式 stockCodes 中解析名称
          if (result.status !== 'fulfilled' || !result.value?.name) {
            const codeClean = codes[i].replace(/^(SH|SZ|HK)/, '')
            const nameFromVars = Array.isArray(vars['stockCodes'])
              ? vars['stockCodes'].find((c: string) => c.startsWith(codeClean))
              : null
            if (nameFromVars) {
              return { code: codeClean, name: nameFromVars.replace(/^\d+/, ''), ratio: 0, value: 0 }
            }
          }
          return raw
        })
        .filter((h): h is { code: string; name: string; ratio: number; value: number } => h !== null)
        .slice(0, 10)

      if (holdings.length === 0) { return null }
      return { date: '', holdings }
    } catch (e) { console.error('[fetchFundPortfolio] error:', e); return null }
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   * 通过 stock-api 搜索匹配（根据基金名称关键词找到对应 ETF）
   */
  async queryEtfMapping(otcCode: string, providedName?: string): Promise<{
    otcCode: string
    otcName: string
    exchangeCode: string
    exchangeName: string
  } | null> {
    // 空码/非法码（截图导入常缺代码）无法映射，直接返回 null
    if (!otcCode || !/^\d{6}$/.test(otcCode)) return null
    // 优先使用调用方传入的持仓名称：添加基金时已取过一次并保存在本地，
    // 批量补全 / 重新查询时也已从 holdings / etfMappings 传入。
    // 本地明明有名称，无需再多此一举地请求 fundgz（且其 dev proxy 路径在
    // 用户环境下会 404，曾导致整条映射逻辑直接失败）。
    let otcName: string = providedName?.trim() || ''
    // 仅当没有任何名称可用时，才回退到 fundgz 获取（部分基金无每日估值会失败）
    if (!otcName) {
      try {
        const fundData = await fetchFundGzJsonp(otcCode)
        otcName = fundData?.name || ''
      } catch {
        /* 取不到名称则不依赖 fundgz，后续若无名称则直接 return null */
      }
    }
    if (!otcName) return null

    try {
      // 统一清洗：去掉 ETF/联接/指数/发起式/QDII，并去掉尾部份额类别字母（A/B/C/D/E/F/H/I/Y）
      // 例："华夏中证5G通信主题ETF联接D" → "华夏中证5G通信主题"
      const stripNoise = (name: string) =>
        name
          .replace(/\(QDII\)/i, ' ')
          .replace(/ETF联接|ETF连接|联接|连接/i, ' ')
          .replace(/发起式/i, ' ')
          .replace(/指数(分级|增强|型)?/i, ' ')
          .replace(/ETF/i, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      const stripShareClass = (x: string) => x.replace(/[ABCDEFHIY]$/i, '').trim()
      const coreName = stripShareClass(stripNoise(otcName))
      const keyword = coreName
      // 去掉市场前缀后的核心主题词，用于生成「2字滑动窗口 + ETF」短词
      // 例："5G通信主题" → 滑窗生成 "通信ETF"，可命中场内简称「通信ETF华夏」
      const noMarketCore = keyword.replace(/^(上证|深证|沪深|中证|创业板|科创板)/, '').trim()

      const s = await ensureStocks()

      // 基金公司前缀列表
      const fundCompanies = ['华宝', '华夏', '易方达', '广发', '南方', '富国', '嘉实', '博时', '招商', '天弘', '工银', '交银', '景顺', '汇添富', '鹏华', '国泰', '东财', '万家', '国联安', '银河', '银华', '长信', '前海开源', '申万菱信', '信达澳亚', '中欧', '兴全', '兴证全球']

      // 生成基础搜索词（核心名 / 去公司名 / 去市场前缀 / 裸主题词）
      const baseTerms = [
        keyword,
        keyword.replace(/发起式/i, '').replace(/连接/i, '').trim(),
        keyword.replace(new RegExp(`^(${fundCompanies.join('|')})`), '').trim(),
        keyword.replace(new RegExp(`^(${fundCompanies.join('|')})`), '').replace(/^(上证|深证|沪深|中证|创业板|科创板)/, '').trim(),
      ]

      // 补充搜索策略：生成多种命名惯例变体
      const additionalTerms: string[] = []
      for (const term of [...new Set(baseTerms)]) {
        if (!term || term.length < 2) continue

        // 去掉市场前缀（上证/深证/沪深等）
        const noMarket = term.replace(/^(上证|深证|沪深|中证|创业板|科创板)/, '').trim()
        if (noMarket && noMarket !== term) additionalTerms.push(noMarket)

        // 替换 "科创板" → "科创"（ETF 名称常用简写）
        const kc = term.replace(/科创板/, '科创').trim()
        if (kc && kc !== term) {
          additionalTerms.push(kc)
          additionalTerms.push(kc + 'ETF')
        }

        // 尝试加 "ETF" 后缀
        additionalTerms.push(term + 'ETF')
      }

      // 激进简化策略：去掉所有噪音，提取核心主题词
      // 例如 "华宝上证科创板芯片发起式" → "科创板芯片" → "科创芯片ETF"
      for (const term of [...new Set(baseTerms)]) {
        if (!term || term.length < 2) continue
        // 去公司名 → 去市场前缀 → 去噪音词
        const simplified = term
          .replace(new RegExp(`^(${fundCompanies.join('|')})`), '')
          .replace(/^(上证|深证|沪深|中证|创业板|科创板)/, '')
          .replace(/发起式|连接/i, '')
          .trim()
        if (simplified && simplified.length >= 2) {
          additionalTerms.push(simplified)
          additionalTerms.push(simplified + 'ETF')
          // 对简化结果中的 "科创板" 再做一次替换
          const kc2 = simplified.replace(/科创板/, '科创')
          if (kc2 !== simplified) {
            additionalTerms.push(kc2)
            additionalTerms.push(kc2 + 'ETF')
          }
        }
      }

      // 补充：裸主题词的 2 字滑动窗口 + "ETF"，覆盖场内 ETF 的简称
      // 例："5G通信主题" → "通信ETF"（搜索源里 515050 的交易简称为"通信ETF华夏"，长全称反向查不到）
      if (noMarketCore && noMarketCore.length >= 2) {
        for (let i = 0; i <= noMarketCore.length - 2; i++) {
          const w = noMarketCore.slice(i, i + 2)
          if (/[一-龥]/.test(w)) additionalTerms.push(w + 'ETF')
        }
      }

      // 去重搜索（每个搜索词之间加间隔，避免东方财富连续请求被限流）
      const searchTerms = [...new Set([...baseTerms, ...additionalTerms].filter(Boolean))]

      const allEtfs = new Map<string, { code: string; name: string }>()
      for (const term of [...new Set(searchTerms)]) {
        if (term.length < 2) continue
        const results = await searchStocksRobust(term)
        for (const r of results) {
          const c = r.code?.replace(/^(SZ|SH)/, '')
          if (c && (c.startsWith('159') || c.startsWith('51') || c.startsWith('56') || c.startsWith('58') || c.startsWith('16'))) {
            const key = c
            if (!allEtfs.has(key)) {
              allEtfs.set(key, { code: c, name: r.name || '' })
            }
          }
        }
        await sleep(100)
      }

      if (allEtfs.size === 0) return null

      // 如果只有1个结果，直接返回
      if (allEtfs.size === 1) {
        const etf = [...allEtfs.values()][0]
        return { otcCode, otcName, exchangeCode: etf.code, exchangeName: etf.name }
      }

      // 多个结果时，按成交额 + 匹配度排序（取流动性最好且相关性最高的）
      const etfCodes = [...allEtfs.keys()]
      const apiCodes = etfCodes.map((c) => toApiCode(c))
      // 提取基金公司名用于匹配
      const otcCompany = fundCompanies.find((fc) => otcName.startsWith(fc)) || ''

      // 提取主题关键词用于名称匹配（如 "中证机器人"、"上证科创板芯片" 等）
      // 保留市场/指数前缀（中证、国证、创业板、上证科创板）以更精确匹配
      const cleanedTheme = otcName
        .replace(/ETF/i, '').replace(/联接/i, '').replace(/连接/i, '')
        .replace(/发起式/i, '').replace(/[ABCDEFHIY]$/i, '')
        .replace(/\(QDII\)/i, '').replace(/指数/i, '')
        .replace(new RegExp(`^(${fundCompanies.join('|')})`), '') // 只去掉公司名，保留市场前缀
        .trim()

      const kwSet = new Set<string>()

      // 1) 完整主题词（含市场前缀）：如 "中证机器人"、"上证科创板芯片"
      if (cleanedTheme.length >= 2) kwSet.add(cleanedTheme)

      // 2) 去掉市场前缀的短主题：如 "机器人"、"科创板芯片"
      const noMarket = cleanedTheme.replace(/^(上证|深证|沪深|中证|创业板|科创板)/, '').trim()
      if (noMarket && noMarket !== cleanedTheme && noMarket.length >= 2) kwSet.add(noMarket)

      // 3) "科创板" → "科创" 变体：如 "科创板芯片" → "科创芯片"
      const kcTheme = (noMarket || cleanedTheme).replace(/科创板/, '科创').trim()
      if (kcTheme && kcTheme.length >= 2 && !kwSet.has(kcTheme)) kwSet.add(kcTheme)

      // 4) 2 字滑动窗口补充（覆盖 ETF 命名习惯中的简写差异）
      //    "中证机器人" → "中证","证机","器人" ｜ "科创芯片" → "科创","创芯","芯片"
      for (const kw of [...kwSet]) {
        if (kw.length >= 3) {
          for (let i = 0; i <= kw.length - 2; i++) {
            kwSet.add(kw.slice(i, i + 2))
          }
        }
      }

      const uniqueThematicKeywords = [...kwSet].filter((kw) => kw.length >= 2)

      try {
        const stocksList = (await s.auto.getStocks(apiCodes)) as StockWithAmount[]
        const scored = stocksList.map((stock, i: number) => ({
          code: etfCodes[i],
          name: allEtfs.get(etfCodes[i])!.name,
          amount: stock?.amount || 0,
          percent: stock?.percent || 0,
          // ETF 名称中是否包含主题关键词（模糊匹配）
          nameMatch: uniqueThematicKeywords.some((kw) => (allEtfs.get(etfCodes[i])?.name || '').includes(kw)) ? 50 : 0,
          // 同一基金公司加分（如华宝场外 → 华宝场内 ETF）
          companyMatch: otcCompany && (allEtfs.get(etfCodes[i])?.name || '').includes(otcCompany) ? 80 : 0,
        }))
        // 按(成交额 + 名称匹配 + 公司匹配)降序排列
        // 成交额相等时，公司匹配优先；都相等时，名称匹配优先
        scored.sort((a, b) => (b.amount + b.nameMatch + b.companyMatch) - (a.amount + a.nameMatch + a.companyMatch))
        const best = scored[0]
        return { otcCode, otcName, exchangeCode: best.code, exchangeName: best.name }
      } catch {
        // 获取行情失败，直接返回第一个结果
        const etf = [...allEtfs.values()][0]
        return { otcCode, otcName, exchangeCode: etf.code, exchangeName: etf.name }
      }
    } catch {
      return null
    }
  }

  /**
   * 搜索股票/基金
   * 通过 stocks.auto.searchStocks 实现关键词搜索
   */
  async searchStocks(key: string): Promise<{ code: string; name: string }[]> {
    return searchStocksRobust(key)
  }

  /**
   * 检查各数据源健康状态
   * 返回每个数据源的可用状态和延迟（毫秒）
   */
  async checkHealth(): Promise<{
    stockApi: { ok: boolean; latency: number; error?: string }
    fundgz: { ok: boolean; latency: number; error?: string }
    pingzhongdata: { ok: boolean; latency: number; error?: string }
  }> {
    const result = {
      stockApi: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
      fundgz: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
      pingzhongdata: { ok: false, latency: 0 } as { ok: boolean; latency: number; error?: string },
    }

    // 1) stock-api: 尝试获取一个已知 ETF 的行情
    try {
      const t0 = performance.now()
      const s = await ensureStocks()
      await s.auto.getStock('SZ159558')
      result.stockApi.ok = true
      result.stockApi.latency = Math.round(performance.now() - t0)
    } catch (e: any) {
      result.stockApi.error = e.message || String(e)
    }

    // 2) fundgz: 尝试获取一个已知基金的实时估值
    try {
      const t0 = performance.now()
      await fetchFundGzJsonp('000001')
      result.fundgz.ok = true
      result.fundgz.latency = Math.round(performance.now() - t0)
    } catch (e: any) {
      result.fundgz.error = e.message || String(e)
    }

    // 3) pingzhongdata: 尝试获取一个已知基金的历史数据（只测连通性）
    try {
      const t0 = performance.now()
      const vars = await fetchFundPingZhongData('000001')
      result.pingzhongdata.ok = !!vars['Data_netWorthTrend']
      result.pingzhongdata.latency = Math.round(performance.now() - t0)
      if (!result.pingzhongdata.ok) result.pingzhongdata.error = '净值数据为空'
    } catch (e: any) {
      result.pingzhongdata.error = e.message || String(e)
    }

    return result
  }
}

export const stockApiAdapter = new StockApiAdapter()
