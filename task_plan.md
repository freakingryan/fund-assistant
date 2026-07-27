# 实现方案：投资决策 SOP 向导（新手指标解读流）

## 目标（Goal）

为新手投资者提供一个**有条理、简单易懂、类 SOP 的分步向导**，把已有的评分体系（9 维信号 + 0-100 综合分 + 多空力量 + 冲突/regime + 买卖理由）按顺序重新包装，每张指标卡配「人话翻译」，最后逼用户**自己下判断并存档决策日志**。入口挂在基金详情页，复用 `useFundDetail()` 上下文，不新开路由、不重算数据。

## 设计形态（5 步，已与用户确认）

1. **看大环境** — 市场 Regime（牛/熊/震荡，剥离 beta 伪信号）
2. **综合评分速览** — 0-100 分 + 评级徽章 + 八态动作，一眼看全局
3. **多空力量 + 一致性** — 力量条看谁主导；信号打架→冲突预警
4. **九维信号逐个过**（核心）— 趋势/MACD/动量/乖离/量能/形态/净值/资金面/板块，每张卡「人话翻译」+ 你的数值 + 三档含义 + 「你认同吗?」(认同/存疑/不认同)
5. **你的判断 + 存日志** — 汇总买入理由 vs 风险因子 → 用户选决策(加/持/减/卖) + 理由 + 每因子认同度 → 存 IndexedDB 决策日志

## 关键事实（已核实，见 findings.md）

- `useFundDetail()` 暴露：signalResult / regime / emFactors / klineData / klineDetectedPatterns / isRealKline / fund / eastmoneyConfig
- `decision = buildDecision({klines, patterns, signalResult, ind, strategies, lowConfidence, nav, em, regime})`（纯函数，可重算）
- `signalResult.contributions[]`：{key, score, detail}；`CAT_LABEL` 映射 9 类中文名
- Dexie 在 `src/stores/db.ts`，现有表 holdings/plans/planLogs/settings

## 实施阶段与可验收结果（Phases）

### P1 — 数据层（scaffold）

- [ ] `src/services/guide/indicatorGlossary.ts`（NEW）：9 类信号 + 排名 的 `label`/`plain`(大白话)/`interpret(score)`（强多/中性/强空，阈值 ±5）。
- [ ] `src/stores/db.ts`（MODIFY）：新增 `decisionLogs` 表。
- [ ] `src/types/index.ts`（MODIFY）：新增 `DecisionLog` 类型。
- [ ] `src/services/guide/decisionLog.ts`（NEW）：`saveDecisionLog()` / `getDecisionLogs(code?)` / `getLatestDecisionLog(code)`。
- [ ] `src/hooks/useFundDecision.ts`（NEW）：包装 `buildDecision`，输入 controller 输出，memo 返回 decision 对象（供向导复用，避免重复计算逻辑散落）。
- **验收**：`tsc --noEmit` 通过；glossary 单测式自检（interpret 三档正确）。

### P2 — 向导 UI（核心）

- [ ] `src/components/holdings/guide/DecisionGuide.tsx`（NEW）：全屏 overlay 步进容器；状态 currentStep + 收集的 perFactor 认同度；上一步/下一步/完成；进度条；支持键盘 Esc 关闭。
- [ ] `src/components/holdings/guide/GuideProgress.tsx`（NEW）：步骤指示（5 步，当前/完成态）。
- [ ] `StepRegime.tsx` / `StepScore.tsx` / `StepForce.tsx` / `StepSignals.tsx` / `StepJudgment.tsx`（NEW）：各步卡片。
  - StepSignals：遍历 `signalResult.contributions`，每卡套用 `indicatorGlossary` 翻译 + 三档配色 + 「认同/存疑/不认同」三态按钮（写入 collected）。
  - StepJudgment：展示 decision.bullReasons/bearReasons → 决策下拉(加/持/减/卖) + 理由 textarea + 认同度汇总 → 调 `saveDecisionLog` → toast 成功。
- [ ] `src/components/holdings/fundDetail/FundDetailPage.tsx`（MODIFY）：header 加「投资体检 SOP」按钮，点击在 `FundDetailProvider` 内渲染 `<DecisionGuide/>` overlay（复用 context）。
- **验收**：`tsc`/`eslint` 通过；dev 起服务手动走通 5 步并能存日志（用户侧验证；agent 只验证构建与类型）。

### P3 — UI 打磨（impeccable）

- [ ] 响应式（移动端全屏、桌面端居中卡片）；步进转场微交互；涨红跌绿配色一致；a11y（按钮 aria、焦点管理、Esc 关闭、进度 aria）。
- [ ] 空态/加载态（kline 未加载时引导先加载）；低置信（净值模式）明确提示。

### P4 — 清理（code-simplifier）

- [ ] 函数单一职责 < 50 行；Step 组件抽取共享 `GlossaryCard`；去重死代码/未用 import；guard clause 早返回。

### P5 — 门禁（setup-pre-commit + verify）

- [ ] husky 已存在（prettier→tsc→eslint→vite build）。运行 `tsc --noEmit` + `eslint` + `vite build` 全绿。
- [ ] 每个阶段独立 commit（P1/P2/P3/P4 各一 commit），不 push（除非用户授权）。
- [ ] 更新 progress.md 与 workspace memory。

## 决策（Decisions）

- **Overlay 而非新路由**：复用 FundDetailProvider context，零重复数据加载，风险最低。
- **重算 decision 用新 hook**：`useFundDecision` 包装 `buildDecision`（纯函数），不改 `DecisionAdvisorCard` 既有逻辑， blast radius 最小。
- **决策日志存 IndexedDB**：`decisionLogs` 表，含 snapshotScore/perFactor/decision/reason，供日后复盘。
- **不碰评分算法**：本功能仅做编排层 + 文案层 + 存储，评分引擎零改动。

## 风险

- FundDetailPage 结构需实现时确认 header 位置与 provider 包裹范围（若 overlay 在 provider 外则 useFundDetail 取不到，需内移）。
- 东财增强因子(regime/em) 在未部署 Worker 时为 undefined → 向导需优雅降级展示「未接入」，不报错。
