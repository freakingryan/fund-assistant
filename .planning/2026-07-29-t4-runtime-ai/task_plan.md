# T4 — 运行时 AI 解释层（Runtime AI Explanation Layer）

> 来源：`PLAN-decision-optimization.md` §5 T4 + §11。地基已具备（`ai.ts` / `backtest/aiAnalysis.ts` / `DecisionAdvisorCard` / `KlinePatternCard`）。
> 目标：在不改动决策算法的前提下，为决策卡片与 K 线形态页增加「AI 综合研判 / AI 形态解读」运行时解释面板，复用现有 `callAI`，未配置时引导去设置页。

## 约束（来自 PLAN §11.5）

- 引擎是唯一真相源：AI 仅解释 + 建议，**绝不伪造/臆造**引擎未提供的金融数据。
- Prompt 强制「仅基于给定结构化字段」；前端不注入任何非输入数据。
- 实时数据无新增 CORS：AI 只消费已取数据，沿用现有 `callAI` 浏览器直连（零后端）。
- per-query 调用设**手动触发**（不打开即刷），避免狂刷消耗用户额度。

## 现有基础设施（已确认）

- `src/services/ai.ts`：`getDefaultAI(): AIConfig|null`、`callAI(config, messages)`。OpenAI 兼容分支已硬编码 `temperature: 0.1`（低温度）；Google 分支不传温度（可接受）。未配置时现有函数抛 `Error("请先在设置页配置 AI API Key")`。
- `src/services/backtest/aiAnalysis.ts`：已有 `NoAIConfiguredError`（L144）、`if (!ai || !ai.apiKey) throw new NoAIConfiguredError()`（L180）。T4 参照此模式。
- `DecisionAdvisorCard.tsx`：已持有 `decision`(useMemo buildDecision) + `em` + `regime` + `klines` props → 足以本地组装 `marketSnapshot`，**卡片自持 AI 状态**，不碰控制器。
- `KlinePatternCard.tsx`：已持有 `klineData` + `klineDetectedPatterns` props，且已有 `onAnalyzeKline`(现有「AI 深度分析」)。T4.2 新增独立「AI 形态解读」面板，**卡片自持 AI 状态**，对 stock/fund 两页零侵入。
- 设置页路由：`/settings`（router.tsx:35）。未配置引导用 `<Link to="/settings">`。

## 设计决策

| 决策点                    | 选择                                                             | 理由                                                                                        |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AI 状态归属               | 卡片自持（useState + 手动触发）                                  | T4.1/T4.2 输入数据卡片已齐备；避免改控制器/个股页，缩小爆炸半径                             |
| 新模块位置                | `src/services/aiAdvisor.ts`                                      | 与 `aiAnalysis.ts` 平级，纯函数 + `NoAIConfiguredError`                                     |
| 与现有「AI 深度分析」关系 | T4.2 并列新增「AI 形态解读」                                     | 现有 analyzeKline=趋势/支撑阻力/买卖建议；T4.2=针对「已检测形态」的人话解读，职责不同不重复 |
| 低温度实现                | 复用 `callAI`(0.1) + system 强约束                               | 不改动 `callAI` 签名，零回归                                                                |
| Prompt 可测性             | 导出 `buildAdjudicationPrompt` / `buildPatternExplanationPrompt` | 验证「仅含给定字段、无臆造」可在无密钥下静态校验                                            |

## 阶段（Phases）

- [x] **Phase 1 — Plan**：探索现有 infra + 写 plan/findings/progress（本文件）。
- [ ] **Phase 2 — Implement `aiAdvisor.ts`**：`NoAIConfiguredError` + `MarketSnapshot` + `adjudicateDecision` + `explainPattern` + 两个可导出 prompt builder。
- [ ] **Phase 3 — T4.1 接入 `DecisionAdvisorCard`**：自持 AI 状态 + 「AI 综合研判」按钮/面板 + 未配置 banner 链接 `/settings`。
- [ ] **Phase 4 — T4.2 接入 `KlinePatternCard`**：自持 AI 状态 + 「AI 形态解读」按钮/面板（仅 isRealKline）+ 未配置 banner。
- [ ] **Phase 5 — Impeccable 打磨**：加载态/错误态/无障碍(aria)/响应式/微交互，与现有卡片风格一致。
- [ ] **Phase 6 — Code-simplifier 清理**：单函数 <50 行、<=4 参数、守卫子句、去重。
- [ ] **Phase 7 — 质量门禁 + 收尾**：`eslint` 0 error + `vite build` success（husky 四关）；更新 PLAN §5 状态行 + §10 T4 记录；`git commit`（**不 push**）。

## 验收（来自 PLAN §11.4）

- T1 已落地的 reversion 卡片能展示 AI 解释。
- 解释文本不出现引擎未提供的捏造数据（prompt builder 静态校验 + 代码审查）。
- 未配置 AI 时 UI 引导去设置页。
- husky 门禁（tsc/eslint/vite build）通过。

## Errors Encountered

| Error      | Attempt | Resolution |
| ---------- | ------- | ---------- |
| (none yet) | —       | —          |
