# 评分回测验证功能 — 实施计划

## Goal
将每只基金的「每日收盘评分快照」持久化到本地 IndexedDB，并回填「次日收盘实际涨跌」，从而验证决策引擎（0-100 评分 + 买/持/卖建议）的真实准确率。提供仪表盘概览卡片 + 独立回测页（明细表 + 统计 + 图表 + 导出），并接入现有备份（Gist/JSON 导入导出）。

## 设计决策（已与用户确认）
- **采集方式**：自动 + 手动。应用启动后若已收盘（工作日 且 当前 > 15:00 本地）且无今日快照，自动为所有持仓建快照；同时在基金详情页/批量按钮提供手动「记录今日评分」与「回填次日涨跌」。
- **入口形态**：仪表盘新增「评分回测概览」卡片（汇总命中率）+ 独立 `/backtest` 页面（完整明细/统计/图表/导出）。点卡片进页面。

## 关键事实（见 findings.md）
- Dexie 库 `src/stores/db.ts`：现有表 holdings/plans/planLogs/settings。新增 `scoreSnapshots`。
- `BackupData`（`src/services/backup.ts`）：{version,exportedAt,appName,holdings,plans,alerts,settings}。扩展 `scoreSnapshots`。
- 决策输出来自 `src/services/decision/decisionEngine.ts` 的 `buildDecision()`：score(0-100)、rating、recommendation(buy/hold/sell)、bullPower、bearPower、agreement、categoryScores、reasons{buy,risk}、strategiesHit。
- 行情数据源：场内ETF类走腾讯 K线（用户网络可达）；纯基金 NAV 历史走东财（需 Cloudflare Worker，当前未部署）→ NAV 快照的 closeValue/nextValue 为尽力而为，缺失时 outcome 留待数据可用再补。
- 图表：`recharts`（已依赖）。

## 阶段

### Phase 1 — 数据层
- [ ] `src/types/index.ts`（或 `src/services/backtest/types.ts`）新增 `ScoreSnapshot` 接口。
- [ ] `src/stores/db.ts` 新增 `scoreSnapshots` 表（主键 `id = ${fundCode}-${date}`），更新 `AppDatabase` 类型。
- [ ] `src/services/backup.ts`：`BackupData` 加 `scoreSnapshots`；`exportAllData` 含 `db.scoreSnapshots.toArray()`；`importAllData` 在事务内 clear+bulkAdd；更新自动同步通知文案（含快照数）。

### Phase 2 — 采集与回填服务
- [ ] `src/services/backtest/decisionSnapshot.ts`：
  - `captureSnapshotForFund(fund)`：复用详情页同一数据管线（取 K线/NAV → 跑形态+指标+分析 → `buildDecision`）→ 写出 ScoreSnapshot（含 closeValue/valueSource）。
  - `captureDailySnapshots()`：遍历持仓，跳过已有今日快照；市场未收盘则跳过（避免盘中半成品）。
  - `reconcileSnapshots()`：对无 nextDate 的快照，取下一交易日 closeValue，算 nextChangePct 与 outcome（buy→涨为正/跌为负；sell 反向；hold→neutral）。幂等。
  - `isMarketClosed()`：工作日且本地时间 > 15:00。
- [ ] `src/services/backtest/stats.ts`：`computeBacktestStats(snapshots)` → 总样本、各建议数、买/卖命中率、整体方向准确率、按评分区间命中率、按建议的平均次日收益。纯函数，便于单测与图表复用。

### Phase 3 — 触发接线
- [ ] `src/App.tsx` 启动初始化与每日定时器：调用 `captureDailySnapshots()` + `reconcileSnapshots()`（节流，仅收盘后）。
- [ ] `src/components/holdings/FundDetailPage.tsx`：加「记录今日评分」按钮（单基金 capture）；可触发单基金 reconcile。

### Phase 4 — UI
- [ ] `src/components/dashboard/BacktestSummaryCard.tsx`：汇总命中率卡片，点击跳 `/backtest`。接入 DashboardPage。
- [ ] `src/components/backtest/BacktestPage.tsx`：工具栏（快照全部持仓今日 / 回填次日涨跌 / 导出CSV / 导出JSON）+ 汇总统计行 + 筛选（基金/建议/日期区间）+ 明细表（日期/基金/评分/评级/建议/收盘值/次日涨跌/结果）。
- [ ] 图表（Recharts）：评分(x) vs 次日涨跌(y) 散点（按 outcome 着色）；按评分区间命中率柱状/累计准确率曲线。可拆 `ScoreScatterChart.tsx` / `AccuracyTrendChart.tsx`。
- [ ] 路由：`src/App.tsx`（或路由文件）新增 `/backtest`；侧边/底部导航加入口。

### Phase 5 — 质量门禁（已具备）
- [ ] `npx tsc --noEmit`、`npx eslint .`（含 no-shadow）、`npx vite build` 全绿。
- [ ] 本地 husky pre-commit 现已含 vite build；GitHub Actions quality.yml + main 分支保护要求 `lint` 通过。

### Phase 6 — 打磨与清理（frontend-quality-workflow）
- [ ] impeccable：响应式、微交互、a11y、配色（涨红跌绿）、间距排版。
- [ ] code-simplifier：单函数职责、守卫子句、去重、删死代码。

## 验收标准
- 手动点「记录今日评分」→ 该基金当日快照写入 IndexedDB，详情可见。
- 应用启动且收盘后 → 自动为全部持仓建快照（无需手动）。
- 「回填次日涨跌」→ 次日实际涨跌与 outcome 计算正确（以已知 ETF 基金抽查验证）。
- `/backtest` 页统计/图表/导出正确；仪表盘卡片汇总与页面一致。
- 备份导出 JSON 含 scoreSnapshots；重新导入后数据还原。
- 质量门禁全绿；提交受 husky + CI + 分支保护约束。

## 开放风险
- 纯 NAV 基金（无 ETF 映射）的 closeValue/nextValue 依赖东财（需 Worker）。未部署时快照仍记录评分，数值留空待补；UI 标注「需部署 Cloudflare Worker 以获取 NAV 实际涨跌」。
- 自动采集依赖「应用当日曾被打开且收盘后」；长期不打开则不采，手动按钮兜底。
