# Findings — stock-sdk indicators / signals 调研

## 库导出（node_modules/stock-sdk/dist）
- `stock-sdk/indicators` 导出：`calcSMA/calcEMA/calcWMA/calcMA/calcMACD/calcBOLL/calcKDJ/calcRSI/calcWR/calcBIAS/calcCCI/calcATR/calcOBV/calcROC/calcDMI/calcSAR/calcKC` + `addIndicators(klines, options)` + 类型 `OHLCV/MAResult/MACDResult/BOLLResult/KDJResult/RSIResult/WRResult/BIASResult/CCIResult/ATRResult/OBVResult/ROCResult/DMIResult/SARResult/KCResult/KlineWithIndicators/AnyHistoryKline`。
- `stock-sdk/signals` 导出：`calcSignals(klines: KlineWithIndicators[], options?): Signal[]` + `Signal` / `SignalType` / `SignalOptions`。
- `addIndicators` 输入 `AnyHistoryKline[]`（需 date/timestamp/tz/code/open/high/low/close/volume 等，字段为 number|null）；返回在每根 kline 上挂 `ma/macd/boll/kdj/rsi/wr/bias/cci/atr/obv/roc/dmi/sar/kc`。
- `calcSignals` 跳过 `timestamp === null` 的 k 线；SignalType：ma_golden_cross/ma_death_cross/macd_golden_cross/macd_death_cross/kdj_golden_cross/kdj_death_cross/kdj_overbought/kdj_oversold/rsi_overbought/rsi_oversold/boll_break_upper/boll_break_lower/sar_reversal_up/sar_reversal_down。

## 关键类型签名
- `OHLCV = { open:number|null; high:number|null; low:number|null; close:number|null; volume?:number|null }`
- `KDJResult = { k,d,j }`；`CCIResult = { cci }`；`BIASResult = { [period]:number|null }`；`ATRResult = { tr, atr }`；`DMIResult = { pdi,mdi,adx,adxr }`；`SARResult = { sar, trend:1|-1, ep, af }`；`KCResult = { mid,upper,lower,width }`；`ROCResult = { roc, signal }`。
- `buildTimeMeta(local, tz)` / `MARKET_TZ.CN='Asia/Shanghai'` 可用于把 "YYYY-MM-DD" 转 timestamp（calcSignals 需要非 null timestamp）。

## 项目既有（勿改）
- `src/types/index.ts` `KLineData = { date, open, close, high, low, volume }`（全 number）。
- `src/services/signalEngine.ts` 已做 MA/MACD/RSI/BOLL/量能/形态 加权评分（-100~+100）。
- `src/services/technicalIndicators.ts` 项目自实现 MA/MACD/BOLL/RSI。
- `src/components/holdings/KlineChartCard.tsx` 区分“基金净值走势”vs“场内 ETF 真实 K 线”。
- `src/components/holdings/KlinePatternCard.tsx` 明确：形态分析需真实 OHLC，净值模式隐藏。
- commit `e3d2d30` 已含东财 Worker 代理方案；pre-commit 钩子（tsc+eslint）已生效。

## 风险/注意
- NAV 模式 klines 的 open/high/low 可能等于 close（无区间）→ OHLC 类指标退化为 0/无意义；必须按“存在真实区间”才计算。
- 需确认详情页中传入面板的 klines 变量名（实现 Phase 3 时 grep 确认）。
- 子路径导入需 Vite 正常解析（stock-sdk 有 exports map，已用于 stockSdkAdapter）。
