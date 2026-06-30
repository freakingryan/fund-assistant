import type { FundQuote, KLineData } from '@/types'
import type { FundDataSource } from './base'
import { useSettingsStore } from '@/stores/settings'

/** 解析百分比/数值字段，兼容 number 和 "12.34%" 字符串 */
function parsePct(v: any): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  return Number(String(v).replace('%', '')) || 0
}

/** 判断当前是否为 A 股交易时段（周一至周五 9:30~15:00） */
function isTradingHours(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const h = now.getHours(), m = now.getMinutes()
  const total = h * 60 + m
  return total >= 9 * 60 + 30 && total < 15 * 60
}

/** 判断基金代码是否为场内 ETF（深交所 159 开头，上交所 51 开头） */
function isEtfFund(code: string): boolean {
  return code.startsWith('159') || code.startsWith('51')
}

/**
 * AKShare 数据源适配器（通过 AKTools HTTP API）
 *
 * 需要本地运行：python -m aktools
 * 文档：https://aktools.akfamily.xyz/
 *
 * API 格式：GET http://{host}:{port}/api/public/{api_name}?参数
 * 返回：JSON 数组
 */
export class AKShareAdapter implements FundDataSource {
  name = 'akshare'

  private get baseURL(): string {
    const cfg = useSettingsStore.getState().settings.dataSource.akshareURL
    // 开发模式下用 Vite proxy 避免 CORS；有自定义配置则用自定义
    if (cfg) return cfg
    // 检测是否在 Vite dev server 下运行（通过 window.location.port 判断非 8080）
    if (typeof window !== 'undefined' && window.location.port && window.location.port !== '8080') {
      return '/aktools'
    }
    return 'http://127.0.0.1:8080'
  }

  private async call<T = any[]>(apiName: string, params: Record<string, string> = {}): Promise<T[]> {
    const url = new URL(`${this.baseURL}/api/public/${apiName}`)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), { mode: 'cors' })
    if (!res.ok) throw new Error(`AKShare HTTP ${res.status}`)

    const data = await res.json()
    if (!Array.isArray(data)) throw new Error('AKShare 返回格式异常')
    return data as T[]
  }

  isConfigured(): boolean {
    return true
  }

  /**
   * fund_name_em 返回所有基金基本信息
   * 字段示例：基金代码, 基金简称, 基金类型, 基金管理人, 基金规模
   */
  async fetchFundInfo(code: string): Promise<{ name: string; type: string }> {
    try {
      const list = await this.call<Record<string, any>>('fund_name_em')
      const fund = list.find((item: any) => String(item['基金代码'] || item['ts_code'] || '') === code)
      if (fund) {
        const name = fund['基金简称'] || fund['基金名称'] || code
        const type = fund['基金类型'] || fund['fund_type'] || '其他'
        return { name, type: this.classifyType(name, type) }
      }
    } catch { /* fallback */ }
    return { name: code, type: '其他' }
  }

  /**
   * fund_open_fund_daily_em — 开放式基金实时净值
   * 盘中+盘后混合策略：交易时段尝试估算净值，盘后使用官方日频净值
   */
  async fetchQuotes(codes: string[]): Promise<FundQuote[]> {
    if (codes.length === 0) return []
    try {
      // 区分 ETF 和非 ETF
      const etfCodes = codes.filter((c) => isEtfFund(c))
      const fundCodes = codes.filter((c) => !isEtfFund(c))
      const allQuotes: FundQuote[] = []

      // 1) ETF 基金：尝试实时行情接口
      if (etfCodes.length > 0) {
        try {
          const etfList = await this.call<Record<string, any>>('fund_etf_spot_em')
          for (const code of etfCodes) {
            const item = etfList.find((i: any) => String(i['代码'] || i['fund_code'] || '') === code)
            if (item) {
              allQuotes.push({
                code,
                name: item['名称'] || item['fund_name'] || code,
                nav: Number(item['最新价'] || item['price'] || 0),
                accNav: 0,
                dailyChange: parsePct(item['涨跌幅'] || item['pct_chg']),
                navDate: new Date().toISOString().slice(0, 10),
              })
            } else {
              allQuotes.push({ code, name: `ETF ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' })
            }
          }
        } catch {
          // ETF 实时行情失败时回退到日频
          for (const code of etfCodes) {
            allQuotes.push({ code, name: `ETF ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' })
          }
        }
      }

      // 2) 非 ETF 基金：盘中用估算净值，盘后用官方净值
      if (fundCodes.length > 0) {
        // 盘中尝试估算净值
        let useEstimation = isTradingHours()
        if (useEstimation) {
          try {
            const estList = await this.call<Record<string, any>>('fund_value_estimation_em')
            for (const code of fundCodes) {
              const item = estList.find((i: any) => String(i['基金代码'] || '') === code)
              if (item) {
                const estNav = Number(item['估算净值'] || 0)
                const estChange = parsePct(item['估算涨幅'] || item['估算增长率'])
                if (estNav > 0) {
                  allQuotes.push({
                    code,
                    name: item['基金简称'] || code,
                    nav: estNav,
                    accNav: 0,
                    dailyChange: estChange,
                    navDate: new Date().toISOString().slice(0, 10),
                  })
                  continue // 跳过后面的日频查询
                }
              }
              // 估算失败，标记为待日频补查
              useEstimation = false
            }
          } catch {
            useEstimation = false
          }
        }

        // 盘后或估算失败：走官方日频净值
        if (!useEstimation) {
          const dailyList = await this.call<Record<string, any>>('fund_open_fund_daily_em')
          for (const code of fundCodes) {
            // 如果已经通过估算接口加入了且有效，跳过
            if (allQuotes.some((q) => q.code === code && q.nav > 0.001 && q.nav !== 1)) continue
            const item = dailyList.find((i: any) => String(i['基金代码'] || '') === code)
            if (item) {
              allQuotes.push({
                code,
                name: item['基金简称'] || code,
                nav: Number(item['单位净值'] || item['最新净值'] || 0),
                accNav: Number(item['累计净值'] || item['单位净值'] || 0),
                dailyChange: parsePct(item['日增长率']),
                navDate: item['净值日期'] || item['trade_date'] || '',
              })
            } else {
              allQuotes.push({ code, name: `基金 ${code}`, nav: 1, accNav: 1, dailyChange: 0, navDate: '' })
            }
          }
        }
      }

      return allQuotes
    } catch { /* fallback */ }
    return []
  }

  /**
   * fund_open_fund_info_em — 历史净值走势
   */
  async fetchKLine(code: string, period = '3m'): Promise<KLineData[]> {
    try {
      const data = await this.call<Record<string, any>>('fund_open_fund_info_em', {
        symbol: code,
        indicator: 'unit_nav',
      })
      if (data.length > 0) {
        return data.map((item: any) => ({
          date: item['净值日期'] || item['date'] || '',
          open: Number(item['单位净值'] || item['nav'] || 0),
          close: Number(item['单位净值'] || item['nav'] || 0),
          high: Number(item['单位净值'] || item['nav'] || 0),
          low: Number(item['单位净值'] || item['nav'] || 0),
          volume: 0,
        })) // AKShare 返回旧→新，无需反转
      }
    } catch { /* fallback */ }
    return []
  }

  /**
   * fund_etf_hist_em — 场内 ETF 日频真实行情（OHLC + 成交量）
   * 参数示例：symbol=512880, period=daily, start_date=20250601, end_date=20250620
   */
  async fetchEtfKLine(code: string, period = '3m'): Promise<KLineData[]> {
    const days = period === '1m' ? 30 : period === '6m' ? 130 : period === '1y' ? 250 : 66
    const end = new Date()
    const start = new Date(end.getTime() - days * 86400000)
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

    try {
      const data = await this.call<Record<string, any>>('fund_etf_hist_em', {
        symbol: code,
        period: 'daily',
        start_date: fmt(start),
        end_date: fmt(end),
      })
      if (data.length > 0) {
        return data.map((item: any) => ({
          date: item['日期'] || item['date'] || '',
          open: Number(item['开盘'] || item['open'] || 0),
          close: Number(item['收盘'] || item['close'] || 0),
          high: Number(item['最高'] || item['high'] || 0),
          low: Number(item['最低'] || item['low'] || 0),
          volume: Number(item['成交量'] || item['volume'] || 0),
        })) // AKShare 返回旧→新，无需反转
      }
    } catch { /* fallback */ }
    return []
  }

  private classifyType(name: string, type: string): string {
    if (type && type !== '其他') {
      if (type.includes('货币')) return '货币型'
      if (type.includes('债券')) return '债券型'
      if (type.includes('指数')) return '指数型'
      if (type.includes('QDII')) return 'QDII'
      if (type.includes('混合')) return '混合型'
      return type
    }
    const n = name
    if (n.includes('货币')) return '货币型'
    if (n.includes('债券') || n.includes('债')) return '债券型'
    if (n.includes('指数') || n.includes('ETF') || n.includes('联接')) return '指数型'
    if (n.includes('QDII')) return 'QDII'
    if (n.includes('混合') || n.includes('灵活')) return '混合型'
    return '股票型'
  }

  /**
   * fund_portfolio_hold_em — 基金持仓明细（前十大重仓股）
   * 参数：symbol=基金代码, date=查询年份（如2024）
   */
  async fetchFundPortfolio(fundCode: string): Promise<{
    date: string
    holdings: { code: string; name: string; ratio: number; value: number }[]
  } | null> {
    try {
      // 尝试最近两年的数据
      const year = String(new Date().getFullYear())
      const data = await this.call<Record<string, any>>('fund_portfolio_hold_em', {
        symbol: fundCode,
        date: year,
      })
      if (data.length === 0) return null

      return {
        date: year,
        holdings: data.map((h: any) => ({
          code: String(h['股票代码'] || h['stk_code'] || h['symbol'] || ''),
          name: String(h['股票名称'] || h['stk_name'] || h['name'] || ''),
          ratio: Number(h['占净值比例'] || h['hold_amount'] || h['ratio'] || 0),
          value: Number(h['持仓市值'] || h['mkv'] || h['market_value'] || 0),
        })).filter((h) => h.name || h.code).slice(0, 10),
      }
    } catch { return null }
  }

  /**
   * 查询场外基金对应的场内 ETF 代码
   * 通过 fund_name_em 获取 OTC 基金名称 → fund_etf_spot_em 匹配 ETF
   */
  async queryEtfMapping(otcCode: string): Promise<{
    otcCode: string
    otcName: string
    exchangeCode: string
    exchangeName: string
  } | null> {
    try {
      // 1) 获取 OTC 基金名称
      const allFunds = await this.call<Record<string, any>>('fund_name_em')
      const otcFund = allFunds.find((f: any) => String(f['基金代码'] || '') === otcCode)
      if (!otcFund) return null

      const otcName: string = otcFund['基金简称'] || otcFund['基金名称'] || ''

      // 2) 从名称中提取主题关键词（去掉 "联接" "ETF" "C" 等后缀）
      const keyword = otcName
        .replace(/ETF/i, '')
        .replace(/联接/i, '')
        .replace(/C$/, '')
        .replace(/A$/, '')
        .replace(/\(QDII\)/i, '')
        .replace(/指数/i, '')
        .trim()

      // 3) 获取所有场内 ETF
      const etfList = await this.call<Record<string, any>>('fund_etf_spot_em')
      // 先按完整名称匹配
      let matched = etfList.find((e: any) => {
        const eName: string = e['基金简称'] || e['name'] || ''
        return eName.includes(keyword) || otcName.includes(eName)
      })
      // 没匹配到则按部分关键词匹配
      if (!matched) {
        const tokens = keyword.split(/[^\w\u4e00-\u9fff]/).filter(Boolean)
        for (const token of tokens) {
          if (token.length < 2) continue
          matched = etfList.find((e: any) => {
            const eName: string = e['基金简称'] || e['name'] || ''
            return eName.includes(token)
          })
          if (matched) break
        }
      }
      if (!matched) return null

      const exCode: string = String(matched['基金代码'] || matched['ts_code'] || matched['code'] || '')
      const exName: string = matched['基金简称'] || matched['name'] || ''
      return { otcCode, otcName, exchangeCode: exCode, exchangeName: exName }
    } catch { return null }
  }

  /**
   * fund_open_fund_rank_em — 开放基金排行
   * symbol: 全部 / 股票型 / 混合型 / 债券型 / 指数型 / QDII / FOF
   */
  async fetchFundRank(symbol = '全部', topN = 50): Promise<{
    code: string; name: string; type: string; nav: number; accNav: number;
    dailyChange: number; week1: number; month1: number; month3: number;
    month6: number; year1: number; year2: number; year3: number;
    thisYear: number; sinceInception: number;
  }[]> {
    try {
      const data = await this.call<Record<string, any>>('fund_open_fund_rank_em', { symbol })
      return data.slice(0, topN).map((item: any) => ({
        code: String(item['基金代码'] || ''),
        name: String(item['基金简称'] || ''),
        type: symbol === '全部' ? String(item['基金类型'] || item['基金简称'] || item['name'] || '') : symbol,
        nav: Number(item['单位净值'] || 0),
        accNav: Number(item['累计净值'] || 0),
        dailyChange: parsePct(item['日增长率']),
        week1: parsePct(item['近1周']),
        month1: parsePct(item['近1月']),
        month3: parsePct(item['近3月']),
        month6: parsePct(item['近6月']),
        year1: parsePct(item['近1年']),
        year2: parsePct(item['近2年']),
        year3: parsePct(item['近3年']),
        thisYear: parsePct(item['今年来']),
        sinceInception: parsePct(item['成立来']),
      }))
    } catch { return [] }
  }
}

export const akshareAdapter = new AKShareAdapter()
