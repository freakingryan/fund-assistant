# Future Enhancements（第三方库可引入能力）

基于 2026-07-18 对 `stock-api` (v2.7.3) 与 `stock-sdk` (v2.4.0) 的 README/codebase 调研，
整理可引入 fund-assistant 的候选能力。**第一档（纯计算 indicators + signals）已立项实现**，
本文件记录剩余的「未来增强」候选，供后续迭代参考，不阻塞当前工作。

## 第一档（已立项，纯本地、零网络）★进行中
- `stock-sdk/indicators`：`calcMACD`/`calcBOLL`/`calcRSI`/`calcBIAS`/`calcMA` 等（部分只需收盘价数组，
  基金净值K线可直接用；KDJ/WR/CCI/ATR/OBV/DMI/SAR/KC 需 OHLCV，仅股票K线可用）。
- `stock-sdk/signals`：`calcSignals` 金叉/死叉/超买超卖/布林突破/SAR反转事件识别。
- **优势**：完全不依赖东方财富，用户网络硬阻断东财也不影响；tree-shake 只引入用到的函数。

## 第二档：基金域深度数据（依赖东方财富，需先部署 Cloudflare Worker）
> ⚠️ 前置条件：用户本地网络对东方财富为**硬阻断（含代理均不可达）**，必须在 GitHub Pages
> 部署 `cloudflare-worker/`（见 `.env.example` 的 `VITE_FUND_WORKER_URL`）后这些接口才可用。
- **同类排名走势** `sdk.fund.rankHistory(code)`：基金在同类型中的排名变化曲线，辅助业绩评价。
- **分红派送** `sdk.fund.dividendList(code)`：基金分红送配历史，支撑分红再投资分析。
- **主题基金** `sdk.fund.theme(...)`：按主题分类发现基金，辅助资产配置与自选拓展。

## 第三档：A股个股向（基金助手非核心，除非扩展个股分析）
- **板块** `sdk.board.industry/*` / `sdk.board.concept/*`：行业/概念板块行情与成分，做板块配置视角。
- **资金流向** `sdk.fundFlow.{individual,market,rank,sectorRank}`：个股/板块/市场资金净流入，量价辅助。
- **沪深港通/北向** `sdk.northbound.{minute,summary,holdingRank,history}`：北向资金持仓与流向，宏观情绪指标。
- **筹码分布** `sdk.chips.{cn,hk,us}`：CYQ 获利比例/成本区间（东财算法本地算，但需东财行情数据作输入）。
- **交易日历** `sdk.calendar.{isTradingDay,marketStatus,nextTradingDay}`：交易日判断与提醒调度（部分走网络）。

## 已接入（不重复引入）
- `stock-api` 股票域（K线/行情/搜索，腾讯源，用户网络可达）。
- `stock-sdk.fund.navHistory` / `estimate`（净值历史/实时估值，走东方财富）。
- 第一档 `stock-sdk/indicators` + `signals`（纯本地，见实现计划）。

## 说明
- `stock-api` 除已接入的股票能力外，MCP/CLI 不适用前端、无基金、无计算，无可引入项。
- 评价指标可行性时，优先级：纯本地计算 > 腾讯源（用户可达）> 东财源（需 Worker）。
