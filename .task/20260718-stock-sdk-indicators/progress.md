# Progress — stock-sdk indicators + signals 引入

## 2026-07-18
- 完成调研与盘点：项目已有 MA/MACD/RSI/BOLL 评分与 K线形态；缺失 KDJ/WR/CCI/BIAS/ATR/OBV/DMI/SAR/KC/ROC 与事件信号。
- 确认 stock-sdk/indicators + /signals 为纯计算 subpath，零网络，不受东财阻断影响。
- 创建 task_plan.md / findings.md / progress.md。
- Phase 2：新增 `src/services/stockSdkIndicators.ts`（映射 KLineData→HistoryKline，addIndicators + calcSignals；NAV 模式仅算 BIAS/ROC）。
- Phase 3：新增 `src/components/holdings/TechnicalIndicatorsPanel.tsx`，接线到 `FundDetailPage` 与 `StockDetailPage`（均置于 SignalScoreCard 之后）。
- Phase 4：响应式网格 + 涨红跌绿主题 + hover 微交互。
- Phase 5：tsc --noEmit / vite build / eslint 全绿（新文件 0 warning；FundDetailPage 既有 warning 与本次改动无关）。
- 运行时校验：addIndicators+calcSignals 对 ETF(OHLC) 与 NAV(无区间) 均正常，ohlcAvailable 守卫生效。
- 坑：stock-sdk/indicators 运行时未导出 buildTimeMeta/MARKET_TZ（仅 .d.ts 有），改用本地 Date.parse 生成 timestamp；面板组件为 named export（页面须用 {} 导入）。
- 待提交：本次 indicators+signals 引入（本地 commit，不 push）。
