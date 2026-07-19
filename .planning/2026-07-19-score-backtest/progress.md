# 进度日志 — 评分回测验证

## 2026-07-19 会话
### 已完成
- **质量门禁加固（用户要求，与回测功能无关但先行）**：
  - ① `package.json` 加 `"prepare":"husky"` 与 devDep `husky@^9.1.7`；`npm install husky` 触发 prepare，`.husky/_` 生成，`core.hooksPath` 设为 `.husky/_` → 新机器 `npm install` 自动激活钩子。
  - ② `.husky/pre-commit` 追加 `vite build` 步骤（与 CI 对齐）。
  - ③ `gh api` 对 `main` 开分支保护：要求 `lint` 状态检查通过 + `enforce_admins=true`。
  - 验证：tsc 无错；eslint 0 errors（88 既有 react-hooks 警告）；vite build 成功。
- **回测功能 Plan（Phase 1 of frontend-quality-workflow）**：
  - 创建 `.planning/2026-07-19-score-backtest/{task_plan.md,findings.md,progress.md}`。
  - 设计决策已与用户确认：自动+手动采集；仪表盘卡片 + `/backtest` 独立页。

### 待办（Next）
- 硬化改动与回测功能均尚未提交（未 push）。

### 错误记录
- 无（本次仅配置与规划，无代码错误）。

## 2026-07-19（续）— 回测功能全部实现
### 已完成（Phase 2-6）
- **Phase 1 数据层**：`src/services/backtest/types.ts`；`db.ts` 新增 `scoreSnapshots` 表(version 5)；`backup.ts` 扩展 `BackupData` + 导出/导入含快照。
- **Phase 2 服务**：`decisionSnapshot.ts`(isMarketClosed/localDateKey/captureSnapshotForFund/captureDailySnapshots/reconcileSnapshots/getAllSnapshots)、`stats.ts`(computeBacktestStats + 文案辅助)。
- **Phase 3 接线**：`App.tsx` 初始化 + 30min 定时器触发采集/回填；`FundDetailPage` 加「记录今日评分」按钮。
- **Phase 4 UI**：`BacktestSummaryCard`(接入 DashboardPage)、`BacktestPage`(工具栏+统计+散点/区间命中率图+筛选明细表+CSV/JSON 导出)、`ScoreScatterChart`、`AccuracyBucketChart`；`router.tsx` 加 `/backtest`；`AppLayout` nav 加「评分回测」。
- **Phase 5 质量门禁**：tsc 无错 · eslint 0 errors/0 no-shadow · vite build 成功（仅既有 chunk-size 提示）。

### 关键约束
- 场内 ETF 类基金（有映射）走腾讯真实 K 线 → 可正常采集+回填；纯净值基金走东财（被网络硬阻断，需部署 Cloudflare Worker 后方可取数），当前无快照。
- 自动采集门禁：仅工作日收盘后(本地>15:00)触发；手动按钮随时可用。
