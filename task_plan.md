# task_plan — ETF 期权（T型/希腊字母/IV）+ 市场状态护栏

> 流水线：planning-with-files（本文件）→ task-implement → impeccable → code-simplifier → gate(husky)
> 数据源决策见 findings.md §3（ETF T型：默认方案 A / 备选 B）。以下按「方案 A」列，选 B 时 C2/C3 的 chain 切到 `index.spot`。

## Feature C — ETF 期权（T型 / 希腊字母 / IV）

- [ ] **C0** `src/lib/optionPricing.ts`：纯函数 `bsPrice` / `greeks(delta,gamma,theta,vega,rho)` / `impliedVol(Newton)`；输入 (type,S,K,T,r,sigma|price)；无报价时仅理论值。
- [ ] **C1** `src/services/etfOptions.ts`：
  - `fetchEtfOptionCates()`（5 类：50ETF/300ETF/500ETF/科创50/科创板50）
  - `fetchEtfOptionMonths(cate)` → `sdk.options.etf.months`（gate: eastmoney.enabled）
  - `fetchEtfOptionExpireDay(cate, month)` → `sdk.options.etf.expireDay`
  - 方案A：`fetchEtfOptionChain(cate, month, expireDay)` → SSE 解析（gate: extraSources.enabled + proxy）；方案B：复用 `sdk.options.index.spot` 演示
  - `fetchEtfOptionQuote(code)` → `sdk.options.etf.dailyKline/minute`（K线/分时）
- [ ] **C2** `src/components/market/EtfOptionPanel.tsx`：
  - 品种(Cate) → 月份(Month) → 到期日(ExpireDay) 三级联动
  - T 型表：左 calls / 中 strike / 右 puts，列含 现价/涨跌/持仓 + **delta/gamma/theta/vega/rho/IV**（调用 optionPricing）
  - 选中合约 K线/分时图（轻量）
  - 门控：方案A 用 ExtraSourceGuard 风格（SSE）；months/expireDay 用 eastmoney 门控
- [ ] **C3** 路由/导航：MarketPage 网格加入 EtfOptionPanel（跨两列）；描述文案更新。
- [ ] **C4** impeccable + code-simplifier + 质量门（tsc/eslint/vite 全绿）。

## Feature D — 市场状态护栏

- [ ] **D0** `src/services/marketStatus.ts`：从 marketBreadth.ts 抽出 `getMarketStatusCN`/`MARKET_STATUS_LABEL`；新增 `isMarketOpen()`、`useMarketStatus()`(30s 刷新)、`nextSessionInfo()`（下一开盘倒计时）。marketBreadth.ts / MarketBreadthCard 改为复用，去重。
- [ ] **D1** `src/components/market/MarketStatusBar.tsx`：全局状态条（开盘中/午间休市/盘前/盘后/已收盘 + 倒计时 + 颜色语义）。
- [ ] **D2** 护栏接入 `notify`：`NotificationNoiseConfig` 加 `marketStatusGuard:boolean`（默认 true）；`notify()` 噪声闸门加一步——非 `open` 时抑制 `info`/`success`，保留 `warning`/`error`。`src/App.tsx` 用 `isMarketOpen()` 替代本地 `isTradingHoursOpen()` 门控自动扫描。
- [ ] **D3** 设置页「通知」Tab 加「仅交易时段推送（非开盘抑制 info/success）」开关（绑 marketStatusGuard）。MarketPage 顶部署 MarketStatusBar；Dashboard 复用。
- [ ] **D4** impeccable + code-simplifier + 质量门。

## 验收（每阶段自验）

- tsc --noEmit 0 error；eslint 0 error/0 warning；vite build 通过；husky 全绿。
- ETF：选 50ETF→当月→到期日 出 T 型表且希腊字母/IV 列有值（方案A 真实链；方案B 股指演示）。
- 护栏：MarketStatusBar 显示正确时段；关闭市场时 info/success 通知被抑制、warning/error 仍发。
