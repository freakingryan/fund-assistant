import type { FundType, FundSector, Market } from '@/types'

/**
 * 基金代码模式匹配
 * A股基金代码规则：
 *   - 00xxxx: 深交所基金（含 LOF/ETF）
 *   - 15xxxx: 深交所基金
 *   - 16xxxx: 深交所基金
 *   - 50xxxx: 上交所基金（含 ETF）
 *   - 51xxxx: 上交所 ETF
 *   - 52xxxx: 上交所基金
 *   - QDII: 一般以 QDII 标识
 * 港股: 0xxxxx（五位数字）
 * 美股: 字母代码
 */

function classifyMarket(code: string): Market {
  const c = code.trim().toUpperCase()
  // 美股：纯字母或含字母的短代码
  if (/^[A-Z]{1,5}$/.test(c) && !/^\d+$/.test(c)) return 'US'
  // 港股：5 位纯数字
  if (/^\d{5}$/.test(c)) return 'HK'
  // 默认为 A 股
  return 'A'
}

function classifyFundType(code: string, name: string): FundType {
  const n = name.toLowerCase()

  // ETF 场内基金
  if (/^51\d{4}$/.test(code) || /^15[89]\d{3}$/.test(code)) return 'etf'

  // 根据名称关键词判断
  if (n.includes('货币') || n.includes('货币型') || n.includes('现金宝')) return 'money'
  if (n.includes('债券') || n.includes('债基') || n.includes('纯债') || n.includes('转债')) return 'bond'
  if (n.includes('qdii') || n.includes('qd') || n.includes('海外') || n.includes('全球')) return 'qdii'
  if (n.includes('指数') || n.includes('etf联接') || n.includes('etf 联接') || n.includes('lof')) return 'index'
  if (n.includes('混合') || n.includes('平衡') || n.includes('灵活配置') || n.includes('稳健')) return 'mixed'
  if (n.includes('股票') || n.includes('股票型') || n.includes('优选') || n.includes('精选')) return 'stock'

  // 默认：根据代码猜测
  if (/^511|^512|^513|^515|^516|^517|^518|^588/.test(code)) return 'etf'
  if (/^501|^502/.test(code)) return 'index' // LOF

  return 'stock'
}

const SECTOR_KEYWORDS: Record<FundSector, RegExp[]> = {
  broad_market: [/沪深300|中证500|中证1000|上证50|创业板|科创50|科创100|沪深/i],
  tech: [/科技|半导体|芯片|人工智能|ai|5g|通信|计算机|互联网|软件|电子|信息/i],
  consumer: [/消费|食品|饮料|白酒|家电|零售|日用|品牌/i],
  healthcare: [/医药|医疗|健康|生物|中药|药/i],
  new_energy: [/新能源|光伏|锂电|电池|新能源车|风电|储能|环保/i],
  finance: [/金融|银行|保险|证券|非银|地产/i],
  manufacturing: [/制造|军工|国防|高端装备|工业|机械|汽车/i],
  real_estate: [/地产|房地产|基建|建筑/i],
  bond_market: [/债/i],
  global: [/海外|全球|纳斯达克|标普|道琼斯|日经|港股|恒生|亚太/i],
  commodity: [/黄金|白银|原油|能源|大宗|商品|有色金属/i],
  other: [],
}

function classifySector(name: string): FundSector {
  for (const [sector, patterns] of Object.entries(SECTOR_KEYWORDS)) {
    for (const p of patterns) {
      if (p.test(name)) return sector as FundSector
    }
  }
  return 'other'
}

/**
 * 一键分类基金（返回 type, sector, market）
 */
export function autoClassify(code: string, name: string) {
  return {
    market: classifyMarket(code),
    type: classifyFundType(code, name),
    sector: classifySector(name),
  }
}
