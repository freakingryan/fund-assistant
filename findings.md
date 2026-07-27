# Findings — 投资决策 SOP 向导

## 真实数据接口（已核实）

- `useFundDetail()` 上下文导出（src/hooks/useFundDetailController.tsx:70-180）：
  - `signalResult: SignalResult | null`
  - `regime: MarketRegime | undefined`
  - `emFactors: EmFactors | undefined`
  - `klineData: any[]`（KLineData[]）
  - `klineDetectedPatterns: DetectedPattern[]`
  - `isRealKline: boolean`
  - `fund: FundHolding | null`
  - `eastmoneyConfig`
- `FundDetailProvider` 包裹子树（line 816-825），`useFundDetail()` 须在 Provider 内调用（line 827-833）。

## decision 对象形状（src/components/holdings/DecisionAdvisorCard.tsx:89-104）

`buildDecision({klines, patterns, signalResult, ind, strategies, lowConfidence, nav, em, regime})` → Decision：

- `actionLabel`, `actionColor` ('up'|'down'|'neutral')
- `ratingLabel`, `score`, `rawScore`, `adjustedScore`, `emDelta`
- `bullRatio` (0-1), `lowConfidence`, `navAvailable`
- `guardrails: {kind, description}[]`
- `conflict: boolean`, `trendBearish: boolean`
- `summary: string`（人话总结）
- `bullReasons: {label, detail, category}[]`
- `bearReasons: {label, detail, category}[]`
- `strategies: {id, name, direction, detail}[]`
- `rawAction`

## 九维信号（CAT_LABEL，DecisionAdvisorCard.tsx:51-62）

trend=趋势, macd=MACD, momentum=动量, bias=乖离, volume=量能, pattern=形态, navmom=净值, capitalflow=资金面, sector=板块, peer=排名

## 单信号明细（SignalScoreCard 用法）

`signalResult.contributions.find(c => c.key === 'macdCross')` → `{key, score, detail}`；阈值 `score >= 5` 偏多(up) / `<= -5` 偏空(down) / 否则中性。

## 计算依赖（给 useFundDecision 用）

- `ind = computeStockSdkIndicators(klines)`
- `nav = !isRealKline ? computeNavFactors(klines) : undefined`
- `strategies = evaluateStrategies(klines, ind)`
- `lowConfidence = !isRealKline`
- 导入：buildDecision/src/services/decision/decisionEngine, computeStockSdkIndicators/src/services/stockSdkIndicators, evaluateStrategies/src/services/strategyLayer, computeNavFactors/src/services/decision/navFactors

## 存储现状

- `src/stores/db.ts`：Dexie，现有表 holdings/plans/planLogs/settings(id='user-settings')。新增 `decisionLogs` 表即可。
- UI 原子组件：`src/components/ui/card.tsx` 的 Card/CardContent/CardHeader/CardTitle；按钮用现有 Button；toast 来自 `@/components/ui/toast`。

## 工作流约定（用户硬性原则）

- 所有 node/npx 命令加 `NODE_OPTIONS=""` 前缀；npm install --force。
- husky 预提交：prettier→tsc --noEmit→eslint→vite build，任一 error 阻断。
- 用户自己起 dev server，agent 用 tsc/eslint/build 验证。
- 不 push 到远端，除非用户明确授权。
