/**
 * 基金/市场/板块标签单一来源
 * TYPE_LABELS / SECTOR_LABELS / MARKET_LABELS 此前在多个页面重复定义，
 * 现集中于此，避免标签不一致与重复维护。
 */

export const TYPE_LABELS: Record<string, string> = {
  stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型',
  qdii: 'QDII', money: '货币型', etf: 'ETF', other: '其他',
}

export const SECTOR_LABELS: Record<string, string> = {
  tech: '科技', consumer: '消费', healthcare: '医药', new_energy: '新能源',
  finance: '金融', manufacturing: '制造', broad_market: '宽基',
  global: '全球', bond_market: '债市', commodity: '大宗商品',
  real_estate: '地产', other: '其他',
}

export const MARKET_LABELS: Record<string, string> = {
  A: 'A股', HK: '港股', US: '美股',
}
