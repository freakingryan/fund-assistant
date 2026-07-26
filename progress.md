# progress — ETF 期权 + 市场状态护栏

## 2026-07-26 计划阶段

- 调研 stock-sdk v2.4.0 期权 API：确认 `etf.{months,expireDay,minute,dailyKline,fiveDayMinute}` 存在；**ETF T 型链缺失**，仅有 `index.spot`（股指期权 io/ho/mo）提供 T 型；Greeks/IV 需前端纯算。
- 确认市场状态已有资产：`marketBreadth.ts` 的 `getMarketStatusCN`/`MARKET_STATUS_LABEL` + `MarketBreadthCard` 徽标 + App.tsx 本地 `isTradingHoursOpen()`。
- 写出 findings.md / task_plan.md，ETF T 型数据源留决策（方案 A=SSE 自实现 / B=股指演示 / C=破原则不取）。
- 下一步：向用户确认 ETF T 型方案（A/B），随后进入 task-implement。
