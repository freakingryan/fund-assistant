# 迁移方案：数据源切换到第三方 stock-sdk + stock-api（双库结合，零自管逻辑）

> ⚠️ **文档核心前提已过时**：本方案大量章节基于「用户网络到东方财富被硬阻断」的前提（含 §1.4 / §1.5 / §1.6、决策 1 / 7、清理清单「全部保留」）。**2026-07-19 实测用户网络可直连东方财富全子域**（pingzhongdata / fundgz / fundf10 / push2his），无需 Cloudflare Worker。「选项 3 保留东财 JSONP 兜底」的紧迫性已显著降低，但代码保留无害。迁移本身（P0–P5）均已落地，本文件仅作历史决策档案保留。

> **修订记录**
> - **2026-07-18（一）K 线数据源变更**：原 P1 计划 `sdk.kline.cn`（东财 `push2his`）经用户浏览器实测整组 `net::ERR_EMPTY_RESPONSE`（网络不可达）；经复核历史代码，本项目 K 线主源其实是**腾讯 `web.ifzq.gtimg.cn`**（用户网络可达）。解决方案：**K 线改用 `stock-api`（已是项目依赖）的 `stocks.auto.getKlines`**（腾讯→新浪→东财自动兜底，浏览器构建自带 JSONP 适配绕开 CORS）。详见 §2.1 / §5 映射表。
> - **2026-07-18（二）架构决策（grill-me）**：经 6 轮决策，确立「双库结合、零自管逻辑、重叠项主/兜底、验证可达才删」的最终方案，详见 §3。

> **状态**：实施中。P0/P1/P2/P3 完成；**P4 搜索已落地**（searchStocks 直连 stock-api 主 + sdk.search 兜底；基金域接口受东财阻塞保持委托旧适配器）；P5 待执行。
>
> **实施原则（来自用户要求）**：
> 1. 接口尽可能使用第三方（`stock-sdk` + `stock-api`），避免自己维护出现奇怪问题；
> 2. 第三方确实实现不了的（场外→场内 ETF 映射的启发式）保留我们的一小段逻辑；
> 3. 迁移时**清理干净废弃代码**，但**不改动任何不相关的功能与代码**；
> 4. 迁移后同步更新 README 等文档；
> 5. **接口变更必须先测试可行再实施**（每阶段先 spike + 浏览器可达性门禁，再替换）；
> 6. **双库重叠接口优先选择可用性更高的那个，另一个作为兜底**（见 §3 决策 4、§5 映射表）。

---

## 1. 背景与动机

### 1.1 现状痛点
当前 `fund-assistant` 的 K线/行情/净值 全部走**自维护的 JSONP + 手写兜底链**：
- `src/adapters/datasource/stock-api.ts`（43KB）：腾讯→东财→新浪三源兜底 + 熔断 + 限流 + JSONP 加载器，全部自写；
- `src/adapters/datasource/jsonp-utils.ts`：fundgz / pingzhongdata 的 `<script>` JSONP 加载器；
- `src/adapters/datasource/eastmoney.ts`：第二个适配器（仅 fundgz 取 info/quotes）。

JSONP 的硬伤（已实测验证）：
- **看不到 HTTP 状态码** → 分不清「被限流 429」还是网络错误 → 只能盲目重试 → **越重试越被限流（恶性循环）**；
- 悬挂的 `<script>` 难以干净 abort/超时；串行慢、DOM 抖动；
- 接口漂移、被拦截都要自己修，维护成本高。

这正好解释了用户观察到的现象：**demo 的 stock-sdk 秒开、不限流，而本项目加载慢、易限流**。

### 1.2 为什么两个第三方库能解决
- **`stock-sdk`**（v2.4.0，基金域专家）：plain `fetch` 直连 CORS 接口，**能看到 HTTP 状态码** → 只对 429/5xx 做指数退避 + jitter 重试，`AbortController` 干净超时；自带多 host CDN 兜底、令牌桶限流、熔断。覆盖**基金全维度**（净值 / 估值 / 行情 / F10 / 信息 / 搜索）。
- **`stock-api`**（v2.7.3，股票域专家，已是项目依赖）：同样走 `fetch`，**浏览器构建自带 JSONP 适配兜底**（腾讯 `smartbox`/`gtimg` 不开放 CORS 时自动降级），内置 `retries:2` + `AbortController` 超时，不盲重试。覆盖**股票全维度**（K线 / 行情 / 搜索），且 K 线默认 `tencent → sina → eastmoney` 三源兜底。

**关键澄清**：`stock-api`（npm 包）与 `stock-sdk`（另一个独立开源项目）是**两个不同仓库**。前者只做股票，后者只做基金。本迁移的精髓正是把两者按「域」组合，各自覆盖自己擅长的部分，重叠项取可用性更高者为主、另一个兜底——从而**彻底移除我们自写的 fetch/JSONP/重试/熔断代码**。

### 1.3 关键实测结论（已验证）
| 接口 | 可达性（用户网络） | 说明 |
|---|---|---|
| 东财 `push2his.eastmoney.com/.../kline/get`（`sdk.kline.cn` 写死走此） | ⚠️ **整组不可达** | 故 K 线不能走 `sdk.kline.cn`，改 `stock-api` |
| 腾讯 `web.ifzq.gtimg.cn/.../fqkline/get`（`stock-api` K线主源） | ✅ 可达 | 浏览器经 `stock-api` JSONP 兜底取数 |
| 腾讯 `qt.gtimg.cn`（stock-sdk / stock-api 股票行情共享） | ✅ 可达 | 两库行情均经此 |
| 东财基金接口（pingzhongdata / fundgz，`sdk.fund.*`） | ⏳ **待用户浏览器验证** | 沙箱屏蔽外网，仅 spike 通过；决定 §3 决策 1 的闸门 |

**结论：当初用 JSONP 是不必要的历史包袱，改成第三方库（fetch / 自带 JSONP 兜底）即可解锁状态码感知、精准退避、干净超时，并消除自管重试导致的恶性循环。**

---

### 1.4 ⚠️ 网络现实（用户浏览器实测，2026-07-18）— 影响基金数据迁移前提
用户真实浏览器三项东财 host 全部失败：
- `push2his.eastmoney.com`（K线）→ `net::ERR_EMPTY_RESPONSE`（网络不可达）
- `fund.eastmoney.com/pingzhongdata`（净值）→ `<script> onerror`（加载失败）
- `fundf10.eastmoney.com`（F10 持仓）→ 经 Vite proxy 转发后 `404`

已核实 **`stock-sdk` 的全部基金接口（`navHistory`/`profile`/`estimate`）底层均走东财**
（`fund.eastmoney.com/pingzhongdata`、`fundgz.1234567.com.cn`，见 SDK 源码
`src/providers/eastmoney/fund.ts`）。故若用户网络到不了东财，**基金数据走 stock-sdk 同样会失败**——
这与「基金数据零自管取数」的前提冲突。

应对（与决策 1 一致）：基金域接口**不强行迁到 stock-sdk**；先试 SDK，失败则回退旧 JSONP 兜底
（保留 `stock-api.ts` / `jsonp-utils.ts` 的东财 JSONP 路径）。若用户网络长期到不了东财，
基金净值/估值/F10 将无可用第三方源（两库均不提供腾讯基金源），需另行解决
（VPN / 放行东财 / 引入腾讯基金源），属计划外阻塞。**用户已确认：东财在其网络长期不可达（选项 b），并选择「保留旧东财 JSONP 代码（选项 3）」——即 `stock-sdk` / `jsonp-utils.ts` / `eastmoney.ts` 等东财相关代码一律保留作兜底，不删除。**

### 1.5 fundgz.1234567.com.cn 实测澄清（修正记忆）
- **归属**：whois 注册主体「上海天天基金销售有限公司」，邮箱 `dnsadmin@eastmoney.com` → **天天基金 = 东方财富子公司**，与 `push2his` 共享同一批 IP（`223.111.194.236` / `39.175.228.67` / `111.51.131.62`）。属东财网络。
- **DNS 前端是腾讯 CDN（`fundgz.1234567.com.cn.cdn.dnsv1.com`）**，而 `push2his` 是 Azure `trafficmanager.cn`。**这是可达性差异点**：fundgz 请求先打腾讯 CDN 边缘，可能绕开直连东财源站——故用户浏览器里 fundgz **有可能反而通**（用户此前报错仅含 pingzhongdata / fundf10，未含 fundgz）。需用浏览器实测确认（见 §11 门禁）。
- **能力边界（实测返回）**：`jsonpgz({...,"dwjz":"2.4020","gsz":"2.3276","gszzl":"-3.10",...})` —— `gsz`/`gszzl` = **盘中估值（实时）**，`dwjz` = **昨日单位净值（单点）**。**fundgz 给不了「净值历史」**；历史曲线走 `fund.eastmoney.com/pingzhongdata`（直连东财、无 CDN，当前确定不可达）。

### 1.6 选项 3 锁定的最终数据源矩阵（用户网络）
| 数据 | 来源 | 状态 |
|---|---|---|
| K线 / ETF / 股票行情 / 股票搜索 | `stock-api`（腾讯 `web.ifzq.gtimg.cn` / `qt.gtimg.cn`） | ✅ 可达，零自管 |
| 基金实时估值（盘中） | `fundgz.1234567.com.cn`（东财，腾讯 CDN 前置） | ⚠️ 待浏览器实测（可能通） |
| 基金最新净值（昨净） | `fundgz` / `pingzhongdata`（东财） | ⚠️ fundgz 待实测；pingzhongdata 直连东财确定不可达 |
| 基金净值历史 | `sdk.fund.navHistory`（东财）/ `pingzhongdata`（直连东财） | ❌ 当前不可达（代码保留作兜底） |
| 基金持仓（F10） | `sdk.fund.profile` / `fundf10`（东财） | ❌ 当前不可达（代码保留作兜底） |

## 2. 双库能力矩阵（已确认事实）

### 2.1 按「域」切分（这是组合的核心）
| 域 | 主库 | 覆盖能力 | 对应本项目接口 |
|---|---|---|---|
| **股票域** | **`stock-api`** | K线（`stocks.auto.getKlines`）、股票/ETF 实时行情（`stocks.auto.getStocks`）、股票/ETF 搜索（`stocks.auto.searchStocks`） | `fetchEtfKLine` / `fetchStockKLine` / `fetchStockQuote`（部分）/ `fetchQuotes`（股票码）/ `searchStocks` |
| **基金域** | **`stock-sdk`** | 净值历史（`fund.navHistory`）、估值（`fund.estimate`）、基金/ETF 行情（`quotes.fund.cn`）、F10 重仓（`fund.profile`）、基金信息（`fund.info`）、基金搜索（`search`） | `fetchKLine(基金)` / `fetchQuotes`（基金码+估值）/ `fetchFundPortfolio` / `fetchFundInfo` / `searchFunds` / `queryEtfMapping`（借助 `estimate`+`search`） |

> `stock-api` **完全没有基金数据**（仅 `stocks` 命名空间），`stock-sdk` **没有腾讯 K 线**（K线写死东财 push2his）。两者天然互补，重叠面只有三项：**K线 / 股票行情 / 股票搜索**。

### 2.2 重叠接口与优先级（决策核心）
| 重叠接口 | 主源（可用性更高） | 兜底 | 理由 |
|---|---|---|---|
| **K线** | `stock-api`（`web.ifzq.gtimg.cn`，用户可达） | `stock-sdk.kline.cn`（东财 push2his，用户不可达但作为库级兜底保留） | 主源已在用户网络实测可达；兜底虽当前不可达，仍按「另一个作为兜底」原则保留调用链 |
| **股票/ETF 行情** | `stock-api`（`stocks.auto.getStocks`，腾讯→新浪→东财三源） | `stock-sdk`（`quotes.cn`，东财，用户网络不可达时作库级兜底） | 主源三源兜底，有效可用性更高 |
| **股票/ETF 搜索** | `stock-api`（`searchStocks`，腾讯 smartbox） | `stock-sdk`（`search`，东财） | 主源腾讯可达；东财可能受限 |

**基金域接口不写跨库兜底**——`stock-api` 做不了基金，写了也无意义，直接调 `stock-sdk`。

### 2.3 SDK 不覆盖（必须保留我们的一小段逻辑）
- **场外基金 → 场内 ETF 映射**：两库均无此能力。
  - 迁移后**重建在第三方调用之上**：用 `sdk.fund.estimate` 取跟踪标的 + `sdk.search` 做名称匹配，保留我们的映射启发式（~190 行逻辑）。这是**唯一保留的自定义取数代码**（非网络库重叠，无第三方可替代）。
- **ETF 映射数据表**：本地 JSON，非网络请求，保留不动。

---

## 3. 已确认决策（grill-me 6 轮拍板）

1. **基金数据可达性闸门（A）**：`stock-sdk` 的每个 `fund.*` 接口（`navHistory`/`estimate`/`profile`/`info`/`quotes.fund`/`search` 基金侧）在替换并删除对应 JSONP 代码前，**必须先在用户真实浏览器逐项验证可达**。若某接口在你网络不可达 → **保留现有 JSONP 兜底不删**，绝不为了「零自管」让基金数据断流。
2. **股票行情主源（A）**：股票/ETF 行情主源 = `stock-api`（`stocks.auto.getStocks`，三源兜底），`stock-sdk.quotes.cn` 作跨库兜底；基金/ETF 行情仍走 `stock-sdk`（ETF 属基金子型）。
3. **搜索主源（A）**：股票/ETF 搜索主源 `stock-api`、兜底 `stock-sdk`；基金搜索 `stock-sdk` 独占（stock-api 无基金搜索）。
4. **跨库兜底机制（A）**：写一个**极薄的 `withCrossLibFallback(primary, fallback, label)` helper**，仅用于 3 个重叠接口（K线 / 股票行情 / 股票搜索）——`try` 主库 → 抛错/空则 `catch` 后 `try` 兜底库。基金域接口直连 `stock-sdk`，**不写**跨库兜底。helper **只做 try/catch 编排，不重新实现 fetch / 重试 / JSONP**——重试、限流、熔断仍 100% 交给两个库各自的内部治理。
5. **适配器架构（A）**：**单一统一适配器**内部同时持有两库（`import StockSDK` + `import { stocks }`），按域路由、重叠接口套 `withCrossLibFallback`。`service.ts` 收敛为仅持这一个适配器，删除 `tryFirst` 多适配器链（跨库兜底已在适配器内完成，service 层再套一层即双重编排）。保留 `base.ts` 接口（便于未来整体替换）。文件名 `stockSdkAdapter.ts` 暂留以减改动面（后续可更名 `dataAdapter.ts`）。
6. **废弃代码清理边界（A）**：遵循「**验证可达才删**」（与决策 1 一致）——任何被两库**已验证可达**接口取代的自管代码即删；**不可达的基金 JSONP + 其依赖的 `jsonp-utils.ts` 暂留作兜底**，直到该接口验证可达再删；**绝不碰无关功能代码**（`etfMapping` 数据、`klineCache`、UI、stores、15 个调用点）；每阶段收尾跑 `tsc`/`eslint`/`build` 确认删除无残留死引用。

7. **选项 3 锁定（用户确认 b+3）**：东财网络长期不可达，且用户选择**保留旧东财 JSONP 代码**。因此 `stock-sdk` 依赖、`jsonp-utils.ts`（fundgz/pingzhongdata）、`eastmoney.ts`（fundgz）**一律保留作兜底，不删除**——即便当前网络下取不到数据，代码留在仓库；若未来开 VPN / 东财恢复即自动复活（符合决策 6「不可达的 JSONP 暂留」）。清理清单改为「全部保留」。

---

## 4. 目标架构（迁移后）

### 4.1 文件变更
```
src/adapters/datasource/
  base.ts                 ▶ 保留（FundDataSource 接口不变）
  service.ts              ▶ 收敛：DataSourceService 只持一个统一适配器；删除 tryFirst 链
  stockSdkAdapter.ts      ▶ 改造为「统一适配器」：内部 import StockSDK + { stocks }，按域路由，重叠接口套 withCrossLibFallback
  periodConfig.ts         ▶ 保留（period↔交易日计数映射，供适配器复用）
  etfMapping.ts           ▶ 保留（已有本地映射数据）；queryEtfMapping 启发式重建在适配器内
  stock-api.ts            ▶ 保留（K线已迁 stock-api；净值/估值兜底仍走其 JSONP 路径，选项 3 不删）
  jsonp-utils.ts          ▶ 保留（fundgz/pingzhongdata JSONP 兜底，选项 3 不删）
  eastmoney.ts            ▶ 保留（fundgz 估值兜底，选项 3 不删）
  crossLibFallback.ts     ▶ 新增（极薄 helper，仅 try/catch 编排）
```

### 4.2 统一适配器内部形态（示意）
```ts
import StockSDK from 'stock-sdk'
import { stocks } from 'stock-api'
import { periodToCount } from './periodConfig'
import type { FundDataSource } from './base'
import { withCrossLibFallback } from './crossLibFallback'

const sdk = new StockSDK()

class UnifiedAdapter implements FundDataSource {
  name = 'stock-sdk+stock-api'

  // —— 股票域（stock-api 主，stock-sdk 兜底）——
  fetchEtfKLine = (code, period = '3m') =>
    withCrossLibFallback(
      () => stocks.auto.getKlines(toSymbol(code), { period: 'day', count: periodToCount(period), adjust: 'qfq' }),
      () => sdk.kline.cn(code, { period: 'daily', adjust: 'qfq' }),   // 当前用户网络不可达，仍保留调用链
      'etfKLine'
    ).then(toKLineData)

  fetchStockKLine = (code, period = '3m') => /* 同上，sym = toSymbol(code) */

  fetchStockQuote = (code) =>
    withCrossLibFallback(
      () => stocks.auto.getStocks([code]),
      () => sdk.quotes.cn([code]),
      'stockQuote'
    )

  searchStocks = (key) =>
    withCrossLibFallback(
      () => stocks.auto.searchStocks(key),
      () => sdk.search(key),
      'searchStocks'
    )

  // —— 基金域（stock-sdk 独占，无跨库兜底）——
  fetchKLine = (code, period = '3m') => sdk.fund.navHistory(code, { period }).then(toNavSeries)   // 受决策1闸门约束
  fetchQuotes = (codes) => {/* 基金码→sdk.quotes.fund.cn + sdk.fund.estimate；股票码→stocks.auto.getStocks */}
  fetchFundPortfolio = (code) => stockApiAdapter.fetchFundPortfolio(code)   // ⚠️ SDK profile 缺 name/ratio，无法替代，保留旧实现（东财不可达时回退）
  fetchFundInfo = (code) => sdk.fund.info(code)
  searchFunds = (key) => sdk.search(key)
  queryEtfMapping = (otcCode) => /* 基于 sdk.fund.estimate + sdk.search 重建启发式 */
  checkHealth = () => {/* 对两库各命名空间做一次轻量探测 */}
}

export const dataSourceAdapter = new UnifiedAdapter()
```

### 4.3 不动的边界（强制）
- `dataSourceService` 对外的 **15 个调用点完全不改**（Dashboard / FundDetail / StockDetail / plans / klineWarm / ai / settings / 搜索等）。
- `src/services/klineCache.ts`（IndexedDB 缓存，「秒开」依赖层）、`src/services/klineWarm.ts`（后台预热）**保留**，仅内部从旧适配器改为 `dataSourceService`（接口不变，无需改）。
- 所有 UI 组件、stores、备份、通知、PWA、ETF 映射数据表，均**不改动**。

---

## 5. 接口映射表（实施时逐条对齐）

| 本项目方法（base.ts） | 主调用（优先） | 兜底调用 | 返回映射 |
|---|---|---|---|
| `fetchEtfKLine(code, period)` | `stocks.auto.getKlines(toSymbol, { period:'day', count, adjust:'qfq' })`（stock-api） | `sdk.kline.cn(code, { daily, qfq })` | 直接映射 `date/open/close/high/low/volume` |
| `fetchStockKLine(code, period)` | 同上（stock-api） | 同上（stock-sdk） | 同上 |
| `fetchKLine(code, period)`（基金净值） | `sdk.fund.navHistory(code, { period })`（stock-sdk，受闸门约束） | 现有 JSONP 净值（不可达才留） | 取 `date/nav` 构造成 `KLineData[]`（无 OHLC，`volume=0`，标志净值序列） |
| `fetchQuotes(codes)` | 场内 ETF/LOF 码→`stocks.auto.getStocks`（stock-api）；基金码→`sdk.quotes.fund.cn`+`sdk.fund.estimate` | 场内 ETF/LOF 码→`sdk.quotes.cn`（兜底） | 映射 `FundQuote{nav, dailyChange}`（场内 nav=现价） |
| `fetchStockQuote(code)` | `stocks.auto.getStocks([code])`（stock-api） | `sdk.quotes.cn([code])` | `FundQuote` |
| `fetchFundPortfolio(code)` | ⚠️ 保留旧实现（`sdk.fund.profile` 仅给 `code+marketId`，缺 `name/ratio`，无法替代） | 旧 F10/pingzhongdata JSONP | `FundPortfolio`（重仓股/资产配置/经理等） |
| `fetchFundInfo(code)` | `sdk.fund.info(code)`（stock-sdk） | — | `{ name, type }` |
| `queryEtfMapping(otcCode)` | 基于 `sdk.fund.estimate` + `sdk.search` 重建（stock-sdk） | —（非网络重叠） | `EtfMapping` |
| `searchStocks(key)` | `stocks.auto.searchStocks(key)`（stock-api） | `sdk.search(key)` | `{ code, name }[]` |
| `searchFunds(key)` | `sdk.search(key)`（stock-sdk，独占） | — | `{ code, name }[]` |
| `checkHealth()` | 对两库各命名空间轻量探测 | — | `DatasourceHealth`（标注 powered-by stock-sdk+stock-api） |

> 类型适配细节（字段名/单位差异）在 **P0 spike / 各阶段浏览器门禁** 中通过真实返回结构确认，不在此臆测。

---

## 6. 分阶段实施计划（每阶段先 spike + 浏览器门禁，再替换）

统一流程：**(a) spike 验证可行性 → (b) 用户浏览器可达性门禁（基金域接口受决策 1 约束）→ (c) 替换实现 → (d) tsc + lint + build → (e) 手动冒烟 → (f) 清理死代码（仅验证可达的部分）**。

### P0 · 接入与可行性验证 ✅ 已完成
- 安装 `stock-sdk@2.4.0`（`npm install --force`，`NODE_OPTIONS=""`）。
- spike：5/6 方法沙箱验证通过（`navHistory`/`estimate`/`profile`/`quotes`/`search`）；`kline.cn` 沙箱不可测 → 触发 P1 改用 stock-api。
- 结论：`stock-api` 浏览器构建含 JSONP 兜底、K线默认走腾讯（用户可达）；`stock-sdk` 做基金、`stock-api` 做股票，双库互补。

### P1 · 真实 K线（ETF / 个股）🔄 代码已落地，待浏览器验证
- 实现：`stockSdkAdapter.fetchEtfKLine`/`fetchStockKLine` 走 `stocks.auto.getKlines`（腾讯→新浪→东财），已删 `sdk.kline.cn` 不可达路径；`service.ts` 首适配器切为 `stockSdkAdapter`；`stock-api.ts` 删 K线三源 JSONP/熔断/`getKlineCooldownInfo`；`klineWarm.ts` 移源熔断暂停；`tryFirst` 重构消除 TS 收窄错误。
- 验证：`tsc`/`eslint`（0 error）/ `vite build` 全过。**待用户浏览器确认 K 线走腾讯 JSONP 出图、push2his 空响应消失。**

### P2 · 基金净值历史 ✅ 已落地（受决策 1 闸门）
- 实现：`stockSdkAdapter.fetchKLine` 优先 `sdk.fund.navHistory(code)`（映射 `date/nav` → `KLineData`，
  `open=close=high=low=nav, volume=0`），失败/空则回退 `stockApiAdapter.fetchKLine`（旧 pingzhongdata JSONP，决策 1 保留）。
- ⚠️ `sdk.fund.navHistory` 底层走东财 pingzhongdata（见 §1.4）：若用户网络到不了东财，该接口亦失败，
  自动回退旧 JSONP（当前同样失败 → 净值图暂空，属网络阻塞非代码问题）。
- 验证：`tsc`/`eslint` 通过（构建待 shell 恢复后复跑）；待用户浏览器确认净值图是否出图（验证东财可达性）。

### P3 · 行情（股票/ETF 主源切换）🔄 已落地（代码+构建验证通过）
- 股票/ETF 行情：`fetchStockQuote` 与场内 `fetchQuotes`（ETF/LOF 码）改直连 `stocks.auto.getStocks`（stock-api，腾讯优先三源兜底）主源 + `sdk.quotes.cn`（兜底，见新增 `crossLibFallback.ts`）。不再委托旧 `stockApiAdapter`。
- 纯 6 位个股码（如 600519）与场外基金码前缀重叠、无法仅凭代码区分，故批量 `fetchQuotes` 仅对明确的场内 ETF/LOF 码走 stock-api；个股行情请走 `fetchStockQuote`（单只）。此分流避免把基金码误发到股票接口。
- 基金行情+估值：受东财网络阻塞且选项 3 保留旧代码，**不迁移**（fundgz/pingzhongdata 路径保留作兜底）。原「清理 jsonp-utils/eastmoney」因选项 3 取消。
- 验证：`tsc`/`eslint` 改动文件 0 error（仓库既有 10 错在无关文件）；`vite build` 通过。

### P4 · 搜索（股票域）/ 基金域保持委托 🔄 已落地（searchStocks 直连两库）
- **`searchStocks` 改直连 `stocks.auto.searchStocks`（腾讯 smartbox，用户网络可达）主源 + `sdk.search`（兜底）**，
  不再委托旧 `stockApiAdapter.searchStocks`（从而摆脱其自管东财 `searchStocksEastmoney` JSONP 兜底分支）。
  自定义 validator = `Array.isArray(r)`（任意数组含空即有效），避免「无匹配」空结果误触发兜底。
  与 P3 风格统一（决策 4 极薄跨库兜底；spike 已确认两库均返回 `{code,name,...}` 可直映射）。
- ⚠️ **基金域接口 `fetchFundInfo` / `fetchFundPortfolio` / `queryEtfMapping` 本阶段不替换、保持委托旧适配器**：
  其底层均走东财（`sdk.fund.info` / `sdk.fund.profile` / `sdk.fund.estimate` + `sdk.search`），当前用户网络
  到不了东财 → 替换后同样失败且失去旧 JSONP 兜底，符合决策 1 闸门（基金域接口须浏览器门禁验证可达才替换）。
  其中 `fetchFundPortfolio` 还属「SDK 不覆盖」（`profile` 仅返 `code+marketId`，缺 `name/ratio` 无法替代）。
- 注：`base.ts` 的 `FundDataSource` 接口**无 `searchFunds` 方法**（它在 `DataSourceService` 扩展），
  基金搜索由 service 层处理，适配器无需实现；故 P4 仅动 `searchStocks`。
- 清理 `stock-api.ts`：因 `fetchFundInfo`/`fetchFundPortfolio`/`queryEtfMapping`/`fetchQuotes(rest)` 仍委托，
  **stock-api.ts 保留（选项 3 不删）**，清理顺延 P5。

### P5 · 收尾（文档同步；架构收敛与清理被选项 3 中和）🔄 已落地（README 同步）
- ✅ **README 同步（本阶段核心交付）**：数据源章节整体重写为「双库结合、零自管取数」——
  股票域 stock-api（K线/行情/搜索，腾讯源）、基金域 stock-sdk（净值/估值/F10，东财源）、
  重叠项主/兜底、`withCrossLibFallback` 说明；**删除旧「自维护 JSONP / 三源熔断 / 冷却期 / 限流」描述**；
  加东财网络可达性提示；保留仍有效的「缓存 TTL / 后台预热」章节；同步技术栈行、项目结构、FAQ、配置章节。
- ⚠️ **决策冲突判定（重要）**：grill-me **决策 5**（service 收敛为单适配器、删 `tryFirst` 链）与用户**后续拍板的选项 3**
  （保留全部东财兜底代码、绝不让基金数据断流）**冲突**。经核实：`service.ts` 的 `tryFirst` 链中
  `eastMoneyAdapter` 提供 `fetchFundInfo`/`fetchQuotes` 的 **fundgz 兜底**（且 `stockApiAdapter.fetchFundInfo`
  用的是 `getStock` 而非 fundgz，覆盖不同）——移除它 = 丢失场外基金名称的 fundgz 兜底，违反选项 3 + 决策 1。
  **后拍板的选项 3 优先于早先的决策 5**，故 `service.ts` 的 `tryFirst` 双适配器链、`eastMoneyAdapter`、
  `stock-api.ts` / `jsonp-utils.ts` / `eastmoney.ts` **全部保留不动**（与 §7 清理清单「全部保留」一致）。
- 结论：P5 无运行代码改动，仅文档；`tsc`/`eslint` 复验无回归（仓库既有 10 错在无关文件不动）。

---

## 7. 废弃代码清理清单（决策 6：验证可达才删）

### 确定删除（选项 3 下——全部改为「保留」）
> 用户已选 b+3：东财网络长期不可达，但**保留旧东财 JSONP 代码不删**。故以下原「确定删除」项现全部**保留作兜底**：
- [x] `stock-api.ts` 内 K线三源 JSONP 等（P1 已删 K线部分；净值/估值 JSONP 路径保留）
- [x] `stock-api.ts` 整体 → **保留**（选项 3）
- [x] `jsonp-utils.ts` → **保留**（选项 3）
- [x] `eastmoney.ts` → **保留**（选项 3）

### 保留（明确不改动）
- [x] `base.ts`、`periodConfig.ts`
- [x] `services/klineCache.ts`、`services/klineWarm.ts`（调用接口不变）
- [x] 全部 UI / stores / 备份 / 通知 / PWA / ETF 映射数据
- [x] `getKlineCacheTTL`（交易时段感知 TTL）等自有缓存策略
- [x] 东财 JSONP 兜底 + `jsonp-utils.ts` + `eastmoney.ts` + `stock-sdk` 依赖（选项 3：保留作兜底，未来东财恢复/VPN 即复活）

### 清理纪律
- 每阶段删代码前 `grep` 确认无引用；删后跑 `tsc` + `eslint` + `vite build`。
- 不触碰无关功能代码（15 个调用点 / UI / stores 等）。

---

## 8. README 更新计划
1. **数据源章节**：改为「K线 / 股票行情 / 搜索 由 `stock-api` 提供（腾讯优先，自带 JSONP 兜底）；基金净值 / 估值 / 行情 / F10 / 搜索 由 `stock-sdk` 提供（东财 + 腾讯 + pingzhongdata 同源）」，删除「自维护 JSONP / 三源熔断 / 冷却期」描述。
2. **后台预热章节**：保留「预取逻辑」，说明仍为自有 IndexedDB 缓存，仅取数改为两库。
3. **新增「依赖说明」**：列出 `stock-sdk`（基金域）与 `stock-api`（股票域）及其职责、双库重叠项的优先级与兜底策略。
4. **移除**：JSONP / dev 代理 / CORS 相关旧说明（如已写入）。

---

## 9. 回滚策略
- 适配器边界隔离：`dataSourceService` 接口不变，回滚 = 恢复旧 wrapper 文件 + 移除统一适配器对两库的直连，调用点无需改。
- 每个阶段独立可回滚：P2 出问题只回退 `fetchKLine`，不影响 K线/行情。
- git：每阶段一个 commit，便于 `git revert` 单阶段（不主动 push）。

---

## 10. 风险与对策
| 风险 | 对策 |
|---|---|
| 打包体积增大 | P0 体积门禁实测；两库均 ESM tree-shake，仅引入所需子命名空间 |
| 第三方生命周期耦合 | 隔离在统一适配器单文件；`base.ts` 接口保证可替换 |
| 数据形状差异（字段名/单位） | spike / 浏览器门禁打印真实结构，逐字段对齐映射，不臆测 |
| 基金域接口用户网络不可达（决策1闸门） | 保留 JSONP 兜底，绝不强行零自管导致断流 |
| K线仍偶发失败 | `withCrossLibFallback` + `stock-api` 三源兜底双重保险 |
| 删除旧代码误伤 | 每阶段 tsc + ESLint 把关；删除前 `grep` 确认无引用 |

---

## 11. 实施前检查清单（gate）
- [x] P0 spike 跑通，5/6 方法可取（kline 触发改用 stock-api）
- [x] K线改用 stock-api 代码落地，`tsc`/`eslint`/`vite build` 通过
- [ ] 用户浏览器确认 K 线走腾讯出图、push2his 空响应消失
  - [ ] 各基金域接口浏览器门禁通过（决策 1）
  - [ ] 浏览器实测 fundgz（`fetchFundGzJsonp('000001')`）是否可达（判断实时估值能否复活；见 §1.5）
  - [ ] 各阶段替换后 `tsc --noEmit` + `eslint` 0 error
- [ ] 手动冒烟：详情页默认净值 / K线秒开 / 行情 / 搜索 / 不限流 / 预热命中
- [ ] 删除废弃代码前确认无引用
