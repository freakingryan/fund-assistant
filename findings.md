# 调研 findings — ETF 期权（T型/希腊字母/IV）+ 市场状态护栏

> 关联任务：用户指令「接下来分别进行 ETF 期权（T型/希腊字母/IV）；市场状态护栏」
> 工作日期：2026-07-26
> 遵循：frontend-quality-workflow（planning-with-files → task-implement → impeccable → code-simplifier → gate）

## 0. 第三方库接入原则（硬性原则，来自 MEMORY）

- 优先 stock-sdk / stock-api；fund-assistant **不手写东财/腾讯 fetch+解析**。
- stock-sdk 门面网络 service（勿自建）：含 `options`、`calendar`（交易日历/市场状态）。
- 非东财/腾讯源（同花顺 10jqka、巨潮 cninfo）已在 `extraSources/` 自实现，经 Worker 反代；可加 SSE（上交所）同范式。
- stock-sdk 第三方 repo 只 clone、不可 push（孤儿 commit 无意义）。

## 1. stock-sdk v2.4.0 期权 API 实测（node_modules/stock-sdk/dist/sdk-38oZXdK7.d.ts）

`StockSDK` 实例（`new StockSDK()` 即可，市场状态为纯时间计算）暴露：

- `sdk.options.etf`
  - `months(cate: ETFOptionCate): Promise<ETFOptionMonth>` → `{ months:string[], stockId, cateId, cateList:string[] }`
  - `expireDay(cate: ETFOptionCate, month: string): Promise<ETFOptionExpireDay>` → `{ expireDay, remainderDays, stockId, name }`
  - `minute(code)`, `dailyKline(code)`, `fiveDayMinute(code)` → 单合约分时/日K
  - **缺**：ETF T 型报价（calls/puts 按 strike 排列的链）
- `sdk.options.index.spot(product: 'io'|'ho'|'mo', contract: string): Promise<OptionTQuoteResult>` → `{ calls: OptionTQuote[], puts: OptionTQuote[] }` —— **这是 stock-sdk 唯一提供的 T 型报价**，但属**中金所股指期权**，非 ETF。
  - `OptionTQuote = { symbol, buyVolume, buyPrice, price, askPrice, askVolume, openInterest, change, strikePrice }`
- `sdk.options.cffex.quotes(opts?)` → 中金所实时行情；`sdk.options.commodity.spot`；`sdk.options.lhb(symbol,date)`

### 关键缺口（ETF 期权）

1. **ETF T 型链**：stock-sdk 对 ETF 只给 months/expireDay/kline，**不给 calls/puts×strike 的 T 型表**。
2. **希腊字母 / IV**：stock-sdk 不提供，需**前端纯计算**（Black-Scholes），不触碰任何外部解析 → 符合原则。

### 希腊字母/IV 计算方案（纯函数，零依赖）

- `src/lib/optionPricing.ts`：`bsPrice(type, S, K, T, r, sigma)`、`greeks(...)`（delta/gamma/theta/vega/rho）、`impliedVol(...)`（Newton 迭代反解 sigma）。
- 输入：标的价格 S（ETF 现价，来自 FundQuote / kline 末值）、行权价 K（链内 strike）、到期 T（expireDay.remainderDays/365）、无风险利率 r（默认 2.0% 可配）、期权价（链内 price）。
- 若链内无 price，则只展示 BS 理论值，不反解 IV（标注「无报价」）。

## 2. 市场状态（护栏）已有资产（无需从零）

- `src/services/marketBreadth.ts`：
  - `getMarketStatusCN(): MarketStatus` → `new StockSDK().calendar.getMarketStatus("CN")`（纯时间，无网络）
  - `MARKET_STATUS_LABEL: Record<MarketStatus,string>`（pre_market/open/lunch_break/after_hours/closed → 盘前/开盘中/午间休市/盘后/已收盘）
- `src/components/dashboard/MarketBreadthCard.tsx` 已渲染市场状态徽标。
- `src/App.tsx:63` 本地 `isTradingHoursOpen()`（仅判断 09:30–11:30 / 13:00–15:00 + 工作日），用于收盘前自动扫描门控（Line 144）。
- `MarketStatus` 类型已 `import type { MarketStatus } from "stock-sdk"`。

### 护栏要做的事（增量）

- D0：将 `getMarketStatusCN` / `MARKET_STATUS_LABEL` 抽出到共享 `src/services/marketStatus.ts`，新增 `isMarketOpen()`、`useMarketStatus()`（30s 自刷新）、`nextSessionInfo()`（下一开盘倒计时）。
- D1：`MarketStatusBar.tsx` 全局状态条（开盘中/午间休市/盘前/盘后/已收盘 + 倒计时），置于 Market 页头（Dashboard 复用）。
- D2：护栏逻辑接入 `notify` 噪声配置——新增 `marketStatusGuard`（bool，默认开）：市场非 `open` 时抑制 `info`/`success` 类通知，保留 `warning`/`error`；并用 `isMarketOpen()` 替代 App.tsx 的 `isTradingHoursOpen()` 门控自动扫描。
- D3：设置页「通知」Tab 增加「仅交易时段推送（非开盘抑制 info/success）」开关。

## 3. ETF T 型数据源决策（需用户拍板，触硬性原则）

stock-sdk 无 ETF T 型链，三条路：

- **A（推荐，符原则）**：在 `extraSources/` 自实现 **SSE 上交所** ETF 期权链解析（非东财/腾讯），经 Worker 反代（allowlist 加 `*.sse.com.cn`）；与同花顺/巨潮同范式。交付**真正 ETF T 型** + Greeks/IV。需用户配 Worker（非东财域，CORS 仍走反代）。
- **B（纯 stock-sdk，T 型非 ETF）**：用 `index.spot`（io/ho/mo 股指期权）做 T 型演示 + ETF 合约浏览器（months/expireDay/kline）。完全合规，但 T 型是股指期权不是 ETF；Greeks/IV 仍算。
- **C（破原则，仅用户明确许可）**：解析东财 ETF 期权链（违反「不手写东财解析」），不推荐。

> 默认按 **A** 规划；若用户选 B 则 T 型演示切到股指期权。

## 4. Worker 反代（如需方案 A）

- `worker/index.js` `ALLOWED_HOST_RE` 已含 `eastmoney.com|10jqka.com.cn|cninfo.com.cn`；方案 A 需加 `sse.com.cn`。
- `src/services/proxyFetch.ts` 的 `PROXY_HOST_RE` 同步加 `sse.com.cn`。
- SSE 端点（待用户/运行时验证）：`query.sse.com.cn` / `option.sse.com.cn` 的合约与行情接口（JSON），经 `x-upstream-host` 反代。

## 5. 文件落地清单（草案）

新增：

- `src/lib/optionPricing.ts`（BS + greeks + IV）
- `src/services/etfOptions.ts`（cates/months/expireDay/chain）
- `src/services/marketStatus.ts`（抽出 + hook）
- `src/components/market/EtfOptionPanel.tsx`
- `src/components/market/MarketStatusBar.tsx`
  编辑：
- `src/components/market/MarketPage.tsx`（挂 EtfOptionPanel + MarketStatusBar）
- `src/services/notify.ts`（marketStatusGuard 规则）
- `src/types/index.ts`（NotificationNoiseConfig 加 marketStatusGuard）
- `src/App.tsx`（isMarketOpen 替代 isTradingHoursOpen；自动扫描门控）
- `src/components/settings/SettingsPage.tsx`（通知 Tab 加开关）
- `src/components/dashboard/MarketBreadthCard.tsx`（复用 marketStatus 服务，去重）
- `worker/index.js` + `proxyFetch.ts`（方案 A 时加 sse.com.cn）
