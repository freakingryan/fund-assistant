/**
 * 数据获取工具模块
 *
 * fundgz.1234567.com.cn — 基金实时估算净值（JSONP，无 CORS）
 * fund.eastmoney.com/pingzhongdata — 基金历史数据（JS，无 CORS）
 *
 * 策略：统一用 <script> 标签（JSONP）加载——<script> 跨域不受 CORS 限制，
 * 开发与生产行为完全一致，无需 Vite proxy。东方财富部分基金无 pingzhongdata
 * 数据时会 301 重定向到 notfound.html，此时脚本 onload 后无对应全局变量，
 * 返回空对象由调用方回退。
 */

// ── 东方财富代理（Cloudflare Worker，可选）─────────
// 本地网络（含代理）无法访问 *.eastmoney.com 时，配置此 Worker URL，由部署在
// Cloudflare 边缘的 Worker 服务端请求东财并转发，绕开本地网络阻断。
// 未配置时回退为直连东财（仅在本地网络可达东财时可用，如开发机挂着可用代理）。
const FUND_WORKER_URL: string | undefined = (import.meta.env as any).VITE_FUND_WORKER_URL
const EM_BASE = FUND_WORKER_URL || 'https://fund.eastmoney.com'
const FUNDGZ_BASE = FUND_WORKER_URL || 'https://fundgz.1234567.com.cn'
const FUNDSUGGEST_BASE = FUND_WORKER_URL || 'https://fundsuggest.eastmoney.com'

// ── JSONP 回调 ─────────────────────────────────────
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
    el.src = `${FUNDGZ_BASE}/js/${code}.js?rt=${Date.now()}`
    el.onerror = () => { pending.delete(code); reject(new Error('JSONP 加载失败')) }
    document.head.appendChild(el)
    setTimeout(() => {
      if (pending.has(code)) { pending.delete(code); reject(new Error('JSONP 超时')) }
    }, timeout)
  })
}

// ── 公开 API ─────────────────────────────────────

/**
 * 获取基金实时估算净值（JSONP，<script> 标签加载，跨域无 CORS 问题）。
 */
export async function fetchFundGzJsonp(code: string, timeout = 10000): Promise<any> {
  return loadJsonp(code, timeout)
}

/**
 * 获取基金历史数据（净值走势、持仓等）。用 <script> 标签（JSONP）加载，跨域无 CORS 问题。
 */

/** 用 <script> 标签加载 pingzhongdata（绝对地址，跨域无 CORS 问题） */
function loadPingZhongData(code: string, timeout: number): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `${EM_BASE}/pingzhongdata/${code}.js?v=${Date.now()}`
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
}

export async function fetchFundPingZhongData(code: string, timeout = 15000): Promise<Record<string, any>> {
  // 始终用 <script> 标签（JSONP）加载：跨域无 CORS 问题，开发与生产行为一致。
  // 东方财富部分基金代码无 pingzhongdata 数据，会 301 重定向到 notfound.html；
  // 此时脚本 onload 后无对应全局变量，返回空对象，由调用方回退。
  return loadPingZhongData(code, timeout)
}

type FundHoldingsF10 = { date: string; holdings: { code: string; name: string; ratio: number }[] }

/** 解析 fundf10 持仓明细 raw JS 文本（`var apidata={content:"...",...}`），返回前十大重仓股。 */
function parseFundHoldingsF10(text: string): FundHoldingsF10 | null {
  // 提取 apidata 的 content 字符串（处理 JS 字符串转义）
  const contentMatch = text.match(/content:\s*"((?:\\.|[^"\\])*)"/s)
  if (!contentMatch) return null
  const content = contentMatch[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
  // 提取报告截止日期
  let date = ''
  const dateMatch = content.match(/截止至[：:]\s*(?:<[^>]*>)?(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) date = dateMatch[1]
  const holdings: { code: string; name: string; ratio: number }[] = []
  // 匹配 table 中的每一行：序号 + 代码 + 名称 + ...占净值比例%
  const regex = /<tr>\s*<td>(\d+)<\/td><td><a[^>]*>(\d{5,6})<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>(\d+\.\d+)%/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    if (holdings.length >= 10) break
    const name = m[3].trim()
    if (!name) continue
    holdings.push({ code: m[2], name, ratio: parseFloat(m[4]) })
  }
  return holdings.length > 0 ? { date, holdings } : null
}

/**
 * 从天天基金 F10 获取基金前十大重仓股明细（含占净值比例）。
 *
 * ⚠️ 特殊限制：`FundArchivesDatas.aspx` **强制校验 Referer 必须是 *.eastmoney.com**（实测：
 * 无 Referer / 跨域 Referer 一律 404），且无 CORS 头、无 JSONP callback。浏览器 JS **无法伪造
 * 跨域 Referer**，故 `<script>`/`fetch` 均无法在纯前端直取。唯一出路是**服务端代理设置 Referer**：
 *  - 开发环境：走 Vite dev proxy（`vite.config.ts` 的 `/fundf10`，已注入 eastmoney Referer）。
 *  - 生产环境（纯静态如 GitHub Pages）：无代理 → 返回 null 由调用方优雅降级；
 *    如需生产可用，须部署边缘代理（Cloudflare Worker 等）设置 Referer 转发。
 */
export async function fetchFundHoldingsF10(code: string, _timeout = 15000): Promise<FundHoldingsF10 | null> {
  try {
    if (import.meta.env.DEV) {
      // 开发环境：走 Vite dev proxy（vite.config.ts 的 /fundf10，已注入 eastmoney Referer）
      const res = await fetch(`/fundf10/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`)
      if (res.ok) return parseFundHoldingsF10(await res.text())
    } else if (FUND_WORKER_URL) {
      // 生产环境：走 Cloudflare Worker 代理（注入 eastmoney Referer），避免本地网络对东财的阻断
      const res = await fetch(`${FUND_WORKER_URL}/fundf10/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`)
      if (res.ok) return parseFundHoldingsF10(await res.text())
    }
  } catch {
    // Worker 不可用 / 东财不可达 → 落到降级
  }
  // 生产环境未配置 Worker：fundf10 需 eastmoney Referer，纯前端无法伪造 → 返回 null 让调用方回退
  return null
}

/**
 * 基金名称匹配候选。
 */
export interface FundCodeCandidate {
  code: string
  name: string
  score: number // 0-1，越大越匹配
  fundType?: string
  category?: number
}

/** 常见基金公司前缀，用于同公司加分（含国海富兰克林） */
const COMPANY_PREFIXES = [
  '天弘', '华夏', '易方达', '华泰柏瑞', '建信', '嘉实', '南方', '广发', '博时', '富国',
  '招商', '汇添富', '鹏华', '工银', '中银', '华安', '国泰', '大成', '银华', '华宝',
  '景顺', '中欧', '兴全', '交银', '光大', '银河', '民生', '中信', '平安', '国寿',
  '申万', '东吴', '方正', '长信', '华富', '浙商', '农银', '上投', '泰信', '诺安',
  '融通', '万家', '中邮', '国投', '前海', '长城', '海富通', '金鹰', '新华', '宝盈',
  '国海富兰克林',
]

/** 编辑距离 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const prev = new Array(n + 1).fill(0)
  const curr = new Array(n + 1).fill(0)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

/** 清洗基金名称，用于匹配（去掉通用词、份额、括号等） */
function cleanFundNameForMatch(name: string): string {
  return name
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/主题指数|指数基金|指数|主题/g, '')
    .replace(/中证/g, '')
    .replace(/发起式|发起|ETF|联接|连接|人民币|美元|现汇|现钞|QDII|FOF/g, '')
    .replace(/混合|股票|债券/g, '')
    .replace(/[ACE](?:类|份额)?$/g, '')
    .trim()
}

/** 计算两个字符串的相似分数（0-1） */
function calcStrScore(keyword: string, candidateName: string): number {
  const k = cleanFundNameForMatch(keyword)
  const c = cleanFundNameForMatch(candidateName)
  if (!k || !c) return 0
  if (k === c) return 1

  // 互相包含：高置信，但需避免短关键词误命中（如“电力”匹配“绿发电力”）
  if (k.includes(c) && c.length > 3) return 0.94
  if (c.includes(k) && k.length > 3) return 0.92

  // 编辑距离归一化
  const dist = levenshtein(k, c)
  const maxLen = Math.max(k.length, c.length)
  const editScore = maxLen > 0 ? 1 - dist / maxLen : 0

  // Jaccard 字符相似度（对中文基金名较稳定）
  const setK = new Set(k)
  const setC = new Set(c)
  let inter = 0
  for (const ch of setK) if (setC.has(ch)) inter++
  const union = setK.size + setC.size - inter
  const jaccard = union > 0 ? inter / union : 0

  return Math.min(0.95, editScore * 0.55 + jaccard * 0.45)
}

/** 计算候选与关键词的匹配分数，综合考虑 NAME / SHORTNAME / OTHERNAME 等别名 */
function calcNameMatchScore(keyword: string, candidate: any): number {
  const k = keyword.trim()
  if (!k) return 0

  const baseInfo = candidate?.FundBaseInfo || {}
  const aliases = [
    candidate?.NAME,
    candidate?.SHORTNAME,
    baseInfo?.SHORTNAME,
    baseInfo?.OTHERNAME,
  ].filter(Boolean) as string[]

  // 同公司前缀加分
  let companyBonus = 0
  for (const p of COMPANY_PREFIXES) {
    if (k.startsWith(p) && aliases.some((a) => a.trim().startsWith(p))) {
      companyBonus = 0.08
      break
    }
  }

  let best = 0
  for (const raw of aliases) {
    const score = calcStrScore(keyword, raw)
    if (score > best) best = score
    // OTHERNAME 是逗号分隔的别名，分别评分
    if (raw.includes(',')) {
      for (const part of raw.split(',')) {
        const partScore = calcStrScore(keyword, part)
        if (partScore > best) best = partScore
      }
    }
  }

  return Math.min(1, best + companyBonus)
}

/**
 * 通过基金名称/关键词反查 6 位基金代码（东方财富基金搜索 JSONP），返回候选列表。
 *
 * 使用 m=9（只搜索基金），避免 m=1 全市场搜索把股票/指数/美股当作基金返回。
 * 过滤 CATEGORY=700（基金）的结果，并综合 NAME/SHORTNAME/OTHERNAME 打分。
 */
export async function fetchFundCodeByNameCandidates(
  name: string,
  timeout = 10000,
): Promise<FundCodeCandidate[]> {
  const keyword = (name || '').trim()
  if (keyword.length < 2) return []
  return new Promise((resolve) => {
    const cbName = `__fundSuggestCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const script = document.createElement('script')
    const cleanup = () => {
      try { delete (window as any)[cbName] } catch { /* ignore */ }
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    ;(window as any)[cbName] = (data: any) => {
      cleanup()
      try {
        const datas: any[] = data?.Datas || []
        // CATEGORY=700 才是基金（股票/指数/美股等其它类别需过滤）
        const funds = datas.filter((d) => d?.CATEGORY === 700 && d?.CODE && /^\d{6}$/.test(String(d.CODE)))
        if (funds.length > 0) {
          const scored = funds
            .map((d) => ({
              code: String(d.CODE),
              name: String(d.NAME || keyword),
              score: calcNameMatchScore(keyword, d),
              fundType: d?.FundBaseInfo?.FTYPE,
              category: d?.CATEGORY,
            }))
            .filter((d) => d.score > 0.35)
            .sort((a, b) => b.score - a.score)
          resolve(scored)
          return
        }
      } catch { /* ignore */ }
      resolve([])
    }
    script.onerror = () => { cleanup(); resolve([]) }
    script.src = `${FUNDSUGGEST_BASE}/FundSearch/api/FundSearchAPI.ashx?m=9&key=${encodeURIComponent(keyword)}&callback=${cbName}&_=${Date.now()}`
    document.head.appendChild(script)
    setTimeout(() => { cleanup(); resolve([]) }, timeout)
  })
}

/** 从基金名称中识别末尾 A/C/E 份额后缀（如 "A类" / "C" / "E份额"） */
function extractShareClass(name: string): string {
  const n = name
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
  const m = n.match(/([ACE])(?:类|份额)?$/)
  return m ? m[1] : ''
}

/** 按份额后缀重新排序候选：同份额优先，无份额其次，不同份额最后 */
function sortByShareClass(candidates: FundCodeCandidate[], shareClass: string): FundCodeCandidate[] {
  if (!shareClass || candidates.length <= 1) return candidates
  const rank = (name: string) => {
    const cls = extractShareClass(name)
    if (cls === shareClass) return 2
    if (!cls) return 1
    return 0
  }
  return [...candidates].sort((a, b) => {
    const ra = rank(a.name)
    const rb = rank(b.name)
    if (ra !== rb) return rb - ra
    return b.score - a.score
  })
}

/** 无明确份额时默认 C 类优先（C > E > A > 无份额），同等级按匹配分数降序 */
export function preferCClass(candidates: FundCodeCandidate[]): FundCodeCandidate[] {
  const rank = (name: string) => {
    const cls = extractShareClass(name)
    if (cls === 'C') return 3
    if (cls === 'E') return 2
    if (cls === 'A') return 1
    return 0
  }
  return [...candidates].sort((a, b) => {
    const ra = rank(a.name)
    const rb = rank(b.name)
    if (ra !== rb) return rb - ra
    return b.score - a.score
  })
}

/** 判断基金名称是否疑似被截断（截图识别常见：结尾不完整或带省略号） */
function isLikelyTruncated(name: string): boolean {
  const n = name.trim()
  if (!n) return false
  // 1) 以省略号结尾
  if (/[…．.]{1,}$/.test(n)) return true
  // 2) 以不完整的基金后缀词结尾（说明被 App UI 截断）
  const tails = [
    '发起', '联接', '联接发', 'ETF联', '主题指数', '指数', '基金',
    '混合', '股票', '债券', 'QDII', 'FOF', '人民币', '美元', '现汇', '现钞',
    '中证', '产业', '行业', '主题',
  ]
  if (tails.some((t) => n.endsWith(t))) return true
  // 3) 名称明显偏短（< 10 字）且不以 A/C/E 份额结尾
  if (n.length < 10 && !/[ACE]$/.test(n)) return true
  return false
}

/**
 * 补全被截断的基金名称（截图识别时 App UI 常截断长名称，如
 * “永赢国证商用卫星通信产业ETF发起…” 应为 “永赢国证商用卫星通信产业ETF联接C”）。
 * 仅对「疑似截断」的名称查接口：取分数高且名称更长的候选作为补全结果；否则返回原名称。
 */
export async function completeFundName(name: string, timeout = 10000): Promise<string> {
  const n = (name || '').trim()
  if (n.length < 4) return n
  if (!isLikelyTruncated(n)) return n
  try {
    const candidates = await fetchFundCodeByNameCandidates(n, timeout)
    // 取 score 高且名称比原名称更长的候选（说明原名称确实被截断）
    const better = candidates.find((c) => c.score >= 0.7 && c.name.length > n.length)
    return better ? better.name : n
  } catch {
    return n
  }
}

/**
 * 通过基金名称/关键词反查 6 位基金代码（东方财富基金搜索 JSONP）。
 *
 * 用途：截图导入（京东金融/支付宝等）识别出的持仓往往只有名称、没有代码，
 * 导入后无法获取行情。此函数按名称反查真实代码，使持仓可用（行情/K线/收益）。
 *
 * 接口：fundsuggest.eastmoney.com（支持 callback 参数，JSONP 跨域可用）。
 * 返回第一个高置信候选 { code, name }，无匹配或失败返回 null。
 * 份额处理：
 * - 名称明确带 A/C/E 份额后缀 → 优先返回同份额候选，避免 C 类被反查成 A 类；
 * - 名称未明确份额（如被截断）→ 默认返回 C 类（C > E > A > 无份额）。
 */
export async function fetchFundCodeByName(name: string, timeout = 10000): Promise<{ code: string; name: string } | null> {
  const keyword = (name || '').trim()
  if (keyword.length < 2) return null
  const candidates = await fetchFundCodeByNameCandidates(keyword, timeout)
  const shareClass = extractShareClass(name)
  // 明确份额 → 同份额优先；未明确份额 → 默认 C 类优先
  const ranked = shareClass ? sortByShareClass(candidates, shareClass) : preferCClass(candidates)
  const best = ranked[0]
  // 高置信候选（>=0.6）才采用；否则认为名称反查不可靠，返回 null
  if (best && best.score >= 0.6) return { code: best.code, name: best.name }
  return null
}
