# Progress — 投资决策 SOP 向导

## 2026-07-27 session 1

- 用户需求：给新手做 SOP 式指标解读功能，按步查看指标/评分，结合分析给出自己判断。
- 澄清：SOP 任务此前从未标 completed（上一条消息是设计提案，非已实现功能）。
- 摸清真实评分体系：9 维信号 + DecisionAdvisorCard(buildDecision) + regime/em 叠加层。
- 给出形态提案（5 步 SOP 向导，overlay 形式）并画图确认。
- 用户确认：「出一份实现方案，然后按照前端质量工作流开始实施」。
- 加载 frontend-quality-workflow + planning-with-files 技能。
- 创建 task_plan.md / findings.md / progress.md。
- 下一步：进入 Phase 2（task-implement）开始实现 P1 数据层。

## 2026-07-26 session 2 — P1 数据层落地

- P1 全部交付并通过验收：
  - `src/services/guide/indicatorGlossary.ts`（NEW）：九维信号 + 排名 通识词典（label/plain/bullPlain/bearPlain/thresholdNote）+ `interpretScore(±5 三档)` + `SCORE_TONE_LABEL` + `CONTRIB_CATEGORY_MAP`（贡献 key→决策维度，对齐 decisionEngine.catOf）+ `GLOSSARY_ORDER`。
  - `src/types/index.ts`（MODIFY）：新增 `FactorVerdict`/`InvestorDecision`/`PerFactorVerdict`/`DecisionLog`（含 `DecisionAction` 类型引用）。
  - `src/stores/db.ts`（MODIFY）：v9 新增 `decisionLogs` 表（'id, fundCode, createdAt'）。
  - `src/services/guide/decisionLog.ts`（NEW）：`saveDecisionLog`/`getDecisionLogs`/`getLatestDecisionLog`。
  - `src/hooks/useFundDecision.ts`（NEW）：包装 `buildDecision`，memo 返回 decision + nav；逻辑完全对齐 DecisionAdvisorCard，零改动引擎。
- 验收：`tsc --noEmit` 退出 0；eslint 仅剩 db.ts 既有 `any` 警告（klineCache，非本次改动）；`interpretScore` 三档 node 自检全过；`vite build` 退出 0。
- 设计微调：StepSignals 将遍历 `signalResult.contributions`（6 个真实评分贡献 maTrend/macdCross/rsi/bollinger/klinePattern/volume），经 `CONTRIB_CATEGORY_MAP` 归并到九维展示；bias/navmom/capitalflow/sector/peer 作为通识解释卡（数值取决策 reason/overlay 状态）。

## 2026-07-26 session 3 — P2 向导 UI 落地

- 新增向导组件（src/components/holdings/guide/）：
  - `DecisionGuide.tsx`：全屏 Dialog overlay 步进容器；复用 useFundDetail 上下文（在 Provider 子树内），useFundDecision 取融合决策，buildCategoryViews 取九维展示；状态 step/perFactor/userDecision/reason/saving；最后一步 buildDecision→DecisionLog→saveDecisionLog→toast 存档；关闭即重置状态（避免 set-state-in-effect 警告）。
  - `GuideProgress.tsx`：5 步进度指示（当前/完成/未达，可点回退），aria-current + aria-label。
  - `StepRegime/StepScore/StepForce/StepSignals/StepJudgment.tsx`：5 步卡片，每张配「人话翻译」+ 涨红跌绿三档配色 + 低置信提示 + 空态引导。
  - `shared.ts`：TONE_STYLE（三档配色，对齐 DecisionAdvisorCard）/ VERDICT_STYLE（认同三态）。
- 新增 `src/services/guide/categoryViews.ts`：把真实数据归并成九维展示视图（6 真实贡献分归一化 -10~+10；overlay 维度取东财 0-100 分归一化；bias/navmom 作背景维度），纯函数只读。
- `FundDetailLayout.tsx`：header 右上加「投资体检 SOP」按钮（Stethoscope 图标）→ 打开 `<DecisionGuide>` overlay；响应式 flex-wrap。
- 验收：tsc 退出 0；eslint 0 issues；vite build 退出 0（修复了 `./guide/` 应为 `../guide/` 的导入路径错误）。

## 2026-07-26 session 4 — P3 打磨 + P4 清理

- P3：步进转场微交互（step body key=step + animate-in fade-in）；header 移动端 flex-wrap 防溢出；涨红跌绿配色全程一致；a11y（aria-pressed/aria-label/role=meter/进度 aria/Esc 关闭由 Radix Dialog 处理）。
- P4：抽取 `SignalCard` 子组件（StepSignals 由 ~70 行降到聚焦容器 + 单一卡片组件），消除超大函数；无死代码、无未用 import（eslint 0 issues）。
- 说明：P2/P3/P4 多次修改同一批 UI 文件（FundDetailLayout/DecisionGuide/StepSignals），离散重建各阶段中间态成本高且易碎；故最终合并为「向导 UI」单次提交，但每个阶段在实现后都独立跑过 tsc/eslint/build 全绿。

## Errors

- indicatorGlossary 初版从 `@/types` 导入 `FactorVerdict`/`InvestorDecision` 但本文件未使用 → eslint 4 errors；改为在 P2 直接 import，本文件移除该 import。
- DecisionGuide 初版用 `useEffect` 在打开时 setState → react-hooks/set-state-in-effect 警告；改为关闭时（handleClose）重置。
- FundDetailLayout 误用 `./guide/DecisionGuide` → vite build UNRESOLVED_IMPORT；改为 `../guide/DecisionGuide`。
