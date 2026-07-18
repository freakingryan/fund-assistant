# 引入 stock-sdk indicators + signals 到 fund-assistant

## Goal
用 `stock-sdk/indicators` 与 `stock-sdk/signals`（纯本地计算、零网络、不受东财阻断影响）为 fund-assistant 增补项目**当前缺失**的技术指标与事件信号，提升净值/ETF 的量化分析能力，且不改动现有可用的 `signalEngine`（MA/MACD/RSI/BOLL 评分）与 `klinePatterns`（K线形态）。

## 现状盘点（findings）
- 项目已有：`src/services/signalEngine.ts` + `technicalIndicators.ts`（MA/MACD/RSI/BOLL/量能加权评分）、`klinePatterns.ts`（K线形态 L1-L3）。
- 项目**缺失**的技术指标：`stock-sdk/indicators` 提供的 KDJ / WR / CCI / BIAS / ATR / OBV / DMI / SAR / KC / ROC。
- 项目**缺失**的事件信号：`stock-sdk/signals.calcSignals` 的 金叉/死叉(MACD/KDJ/MA)、超买超卖(KDJ/RSI)、布林突破、SAR反转。
- 关键约束：
  - NAV（净值走势）模式只有 close，无真实 OHLC → KDJ/WR/CCI/ATR/OBV/DMI/SAR/KC 需要 OHLCV，**NAV 模式下仅能算 close 类（BIAS/ROC）**，需提示“需场内 ETF 真实 K 线”。
  - ETF（场内真实 K 线）模式有完整 OHLCV → 全部指标可用。
  - `stock-sdk/indicators` 与 `/signals` 是纯计算 subpath，tree-shake 友好，不会引入东财网络调用。

## 架构决策
- 新增服务 `src/services/stockSdkIndicators.ts`：
  - 输入 `KLineData[]`（项目既有类型：date/open/close/high/low/volume 均为 number）。
  - 映射为 stock-sdk 的 `OHLCV[]`（open/high/low/close/volume）。
  - 用 `addIndicators(klines, fullOptions)` 一次性算出全部指标得到 `KlineWithIndicators[]`；再用 `calcSignals(klinesWithInds, options)` 得事件信号。
  - 仅在“存在真实区间”（`klines.some(k => k.high > k.low)`）时计算 OHLC 类指标；否则跳过并标记 `ohlcAvailable=false`。
  - 长度不足（< 最小周期）时优雅返回空，不报错。
  - 返回结构 `StockSdkIndicatorsResult`：
    - `ohlcAvailable: boolean`
    - `latest`: 各指标最新非空值 + 中文解读（超买/超卖/正常/趋势方向）
    - `signals`: 最近 N（默认 12）条 `Signal` 转成中文可读事件（type 标签 + 日期 + 方向色）
- 新增组件 `src/components/holdings/TechnicalIndicatorsPanel.tsx`：
  - props: `klines: KLineData[]`
  - `useMemo` 调 `computeStockSdkIndicators(klines)`
  - 渲染：① 指标最新值卡片网格（KDJ/WR/CCI/BIAS/ATR/DMI/SAR/KC，含超买超卖/趋势着色）；② 信号事件列表（金叉/死叉/超买/超卖/布林突破/SAR反转，按日期倒序，涨红跌绿）。
  - 空数据 / NAV 模式提示态。
- 接线：`FundDetailPage.tsx`、`StockDetailPage.tsx` 在左侧列（KlinePatternCard / SignalScoreCard 附近）加入 `<TechnicalIndicatorsPanel klines={当前展示的 KLineData[]} />`。

## Phases
- [x] Phase 1 — Plan（本文件 + findings + progress）
- [x] Phase 2 — 实现 `stockSdkIndicators.ts`（纯计算服务 + 类型）
- [x] Phase 3 — 实现 `TechnicalIndicatorsPanel.tsx` 并接线到两个详情页
- [x] Phase 4 — impeccable：响应式网格、主题(涨红跌绿)、微交互(hover)
- [x] Phase 5 — code-simplifier 清理 + 门禁（tsc --noEmit / vite build / eslint 全绿）

## 验收
- `NODE_OPTIONS="" npx tsc --noEmit` 0 error
- `NODE_OPTIONS="" npx vite build` 成功
- ETF 模式下面板显示 KDJ/WR/CCI/BIAS/ATR/DMI/SAR/KC 最新值 + 信号事件；NAV 模式仅显示 BIAS/ROC 并提示需 ETF K 线。
- 不改动 signalEngine / klinePatterns 既有行为。
- 不引入任何东财网络请求（纯计算）。
