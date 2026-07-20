# 评分回测 — AI 辅助分析 + 按日回看 + 每日首次触发

## Goal
在既有「评分回测验证」模块（已支持自动采集/持久化/回填）之上补齐三项能力：
1. **AI 辅助分析算法**（走可配置 LLM API，复用现有 `services/ai.ts`）
2. **按日期回看视图**（明细表日期筛选 + 每日方向性准确率趋势曲线）
3. **严格「每日首次」自动触发**（capture 加日期守卫，避免每 30min 重复尝试）

## 现状（调研结论，勿重复造轮子）
- 数据层已有：`db.scoreSnapshots`（每基金每日快照，主键 `code-date`）、`db.captureReports`、`db.dailyReports`；db 当前 v7。
- AI 基础设施已完备：`services/ai.ts` 导出 `callAI(config, messages)` + `getDefaultAI()`；`AIConfig`/`aiConfigs`/`defaultAIProvider` 已在 settings；SettingsPage 已有 AI 配置 UI。→ **AI 分析直接复用，无需新建 API 层**。
- `services/klineAnalysis.ts` 是 AI 分析的模式范例（buildPrompt → callAI → parseJson → 降级）。
- 触发现状：`App.tsx` init + 每 30min 定时都调 `captureDailySnapshots()`（收盘门禁+幂等去重）/`reconcileSnapshots()`。缺「每日首次」显式守卫。
- 统计现状：`services/backtest/stats.ts` 有 `computeBacktestStats`，缺按日聚合。

## Phases

### Phase 1 — Plan ✅
- [x] 调研既有回测/AI 模块，定型设计
- [x] 建计划文档

### Phase 2 — 数据层 & 类型 ✅
- [x] `types/backtest/types.ts` 新增 `AiBacktestAnalysis` + `DailyAccuracyPoint`（BucketStat 类型导入）
- [x] `db.ts` 升 v8：新增 `aiAnalyses` 表（主键 id，索引 createdAt）
- [x] `types/index.ts` `UserSettings.backtest?: { lastAutoCaptureDate }`；settings.ts 默认值 + `updateBacktestMeta`
- 验收：tsc 通过 ✅

### Phase 3 — 服务层 ✅
- [x] `stats.ts` `computeDailyAccuracySeries(snapshots): DailyAccuracyPoint[]`
- [x] 新建 `services/backtest/aiAnalysis.ts`：`buildBacktestAnalysisPrompt` + `analyzeBacktestWithAI`（复用 callAI/getDefaultAI，未配置抛 NoAIConfiguredError）+ `getAllAiAnalyses`/`deleteAiAnalysis`
- 验收：tsc 通过 ✅

### Phase 4 — 触发层（每日首次守卫）✅
- [x] `App.tsx` 新增 `autoCaptureBacktestOnce()`：读 lastAutoCaptureDate，等于今日则跳过；capture 成功后仅 isMarketClosed 时写今日
- 验收：tsc 通过 ✅

### Phase 5 — UI 层 ✅
- [x] 新建 `DailyAccuracyTrendChart.tsx`（Recharts 双轴折线，准确率+次日涨跌拆涨红跌绿）
- [x] 新建 `AiAnalysisPanel.tsx`（分析按钮 + loading + 结果卡片 + 历史回看 + 删除 + 未配置引导）
- [x] `BacktestPage.tsx`：明细表加日期筛选下拉；插入趋势图；插入 AI 分析面板
- 验收：vite build 通过 ✅

### Phase 6-8 — 打磨/清理/总门禁 ✅
- [x] tsc 0 error / eslint --quiet 0 error / vite build 通过
- [x] 更新 PLAN.md（Phase 16.5/16.6 + /backtest 路由）
- [x] 未 push（等用户确认）

## Decisions
- AI 走 OpenAI 兼容 `callAI`（复用），用户在设置页已配的 provider/key。浏览器直连有 CORS 风险 → 提示用户用支持 CORS 的端点（deepseek/openrouter 等可用）。
- 「每日首次」仅约束自动 capture；reconcile 保留复查（回填依赖外部次日数据到达时机）。
- AI 分析结果落库可回看，非一次性。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| - | - | - |
