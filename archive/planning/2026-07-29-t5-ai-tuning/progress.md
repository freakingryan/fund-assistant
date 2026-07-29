# Progress — T5 AI 调参反馈环（归档占位）

> ⚠️ **重建说明**：本文件原为迭代期工作文档（未跟踪、在后续清理中被误删且从未入库，git 无历史可还原）。
> 以下内容由会话记忆重建，**非原始文件逐字还原**，仅保留关键结论与 commit 映射，供归档追溯。
> 权威实施记录以 `PLAN-decision-optimization.md` §10 T5 为准。

## 目标

AI 调参反馈环：**人在环**，AI 只产出白名单内的结构化参数 diff，用户「采纳」后才写入 `decisionParams` 并即时生效；AI 永不直改算法结构。

## 迭代拆分（4 段 Ralph 风格，每段独立提交 + husky 门禁）

- **T5.1 参数外置** — commit `aa9e01f`
  - 新增 `src/services/decision/decisionParams.ts`（纯模块、零依赖，Node 端 `verify-decision.mts` 可直接跑）。
  - 内联权重/阈值抽成 `DEFAULT_PARAMS`（与硬编码逐字节一致）+ 注入式 `setDecisionParamsOverride()` + 白名单 `PARAM_SCHEMA`（30 个数值叶子：路径/标签/范围/分组）。
  - `buildDecision` 签名不变，引擎内部改读 `getDecisionParams()`；settings store 注入 override。
  - 验收：`verify-decision.mts` 基线（94 行）vs 外置后输出 diff 为空 → 零回归。
- **T5.2 调参反馈环 + 人审闭环** — commit `43011e1`
  - `src/services/backtest/tuningProposal.ts`：`buildTuningProposalPrompt`（白名单 schema + 统计 + 样本）/ `parseAndValidateProposal`（路径白名单 + clamp + 去重 + 丢弃 no-op + ≤5 条，droppedCount 透明）/ `generateTuningProposal`（落库 pending、作废旧 pending）/ `adoptTuningProposal`（快照 `prevOverride` → 增量合入 `settings.decisionParams` → 引擎即时生效）/ `rejectTuningProposal` / `rollbackTuningProposal` / `resetDecisionParamsToDefault` / `getPendingProposal` / `getAllTuningProposals`。
  - `src/services/backtest/types.ts` 新增 `ParamDiffItem` / `TuningProposal` / `TuningProposalStatus`。
  - `src/stores/db.ts` v10 新增 `tuningProposals` 表。
  - **反幻觉硬约束**：AI 只能输出白名单内数值 diff，采纳前二次 clamp，永远不改算法结构。
- **T5.3 自动触发** — commit `052c0f4`
  - `maybeAutoTune(snapshots)`：距上次提案新增已结算样本 ≥ `AUTO_TUNE_MIN_NEW_SETTLED`(20) 或 ≥ `AUTO_TUNE_INTERVAL_MS`(7 天) 且有新样本时，生成 **pending（绝不自动采纳）** 提案；静默跳过 AI 未配置 / 已有待审 / 并发。
  - 触发元数据从 `tuningProposals` 表最近一条推导（零额外持久化）。
  - `App.tsx` 在 init + 30 分钟定时复查后接 `autoTuneCheck()`，生成后 in-app 通知待审。
- **T5.4 反馈可视化** — commit `9bb607f`
  - 新增 `src/components/backtest/AiTuningPanel.tsx` 并嵌入 `BacktestPage`。
  - 区块：① 当前生效参数按 `PARAM_SCHEMA` 分组、标注默认/自定义、提供「恢复默认」；② 待审 AI 提案（`getPendingProposal`）以「当前 vs 建议」对比表 + 采纳/拒绝（人审闭环）+ 统计摘要 + 丢弃计数 + 原始返回折叠；③ 采纳历史（`getAllTuningProposals`）状态流转徽章（pending/adopted/rejected/rolledBack）+ 已采纳项一键回滚；④ 手动「生成 AI 调参提案」入口（`generateTuningProposal('manual')`），未配置 AI 时明确引导。
  - 复用 `AiAnalysisPanel` 视觉风格；`eslint` 0 error / `vite build` success。

## 验收

- `verify-decision.mts` 外置零回归；T5.4 husky 门禁全过（prettier → tsc → eslint → vite build）。
- 采纳一处 diff 后下次评分即读新值、可观测、可回滚。

## 爆炸半径

T5.1 仅改引擎内参数读取方式（行为不变）；T5.2–T5.4 全部落在 backtest 服务 + 回测页卡片，未触碰决策引擎核心算法与个股/持仓控制器。
