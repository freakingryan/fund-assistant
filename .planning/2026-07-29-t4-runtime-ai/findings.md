# Findings — T4 运行时 AI 解释层

## 现有 AI 调用基础设施（可复用，勿重复造轮子）

- `src/services/ai.ts`
  - `getDefaultAI(): AIConfig | null` — 取设置页 `settings.aiConfigs` + `settings.defaultAIProvider`；无 apiKey 返回 null。
  - `callAI(config, messages)` — 统一封装 deepseek/openai/groq/openrouter/agnes/google/custom **浏览器直连**（零后端）。
  - OpenAI 兼容分支已硬编码 `temperature: 0.1`（已是低温度，符合 T4「温度低」要求）。
  - 未配置时现有业务函数抛 `Error("请先在设置页配置 AI API Key")`（非结构化）。
- `src/services/backtest/aiAnalysis.ts`
  - 已有 `NoAIConfiguredError` 类（L144，`this.name="NoAIConfiguredError"`）。
  - 调用范式：`const ai = getDefaultAI(); if (!ai || !ai.apiKey) throw new NoAIConfiguredError();` 然后 `callAI(ai, [{role:"user", content: prompt}])` —— T4 直接复用同一套。

## 决策卡片（T4.1 落点）

- `DecisionAdvisorCard.tsx`（526 行）
  - Props 已含：`klines`, `patterns`, `signalResult`, `isRealKline`, `em`, `regime`, `navKlines`, `asOf`, `fetchedAt`。
  - 内部 `useMemo` 已算 `decision`（`buildDecision(...)`），`decision` 暴露全部结构化字段：`actionLabel/ratingLabel/score/rawScore/adjustedScore/bullRatio/bullReasons/bearReasons/guardrails[]/signalType/conflict/trendBearish/midTermDown/midTermReturnPct/riskProfile/summary/emDelta/strategies[]/actionColor/lowConfidence/navAvailable/rawAction`。
  - 渲染点：人话总结 `<p>{decision.summary}</p>`（L284）之后插入 AI 面板最自然。
  - 调用方两个：`FundDecisionAdvisorCard`（传 ctrl.em/regime）、`DecisionGuide`（传 ctrl.em/regime）。均喂 em/regime → T4.1 对两处自动生效。
  - **结论**：卡片自持 AI 状态（useState + 手动触发），无需改控制器。

## K 线形态卡（T4.2 落点）

- `KlinePatternCard.tsx`（451 行，共享组件）
  - Props 已含：`klineData`, `klineDetectedPatterns`(DetectedPattern[]), `isRealKline`, 以及现有 `onAnalyzeKline`/`klineAnalysis`(现有「AI 深度分析」：trend/support/resistance/advice)。
  - 现有「AI 深度分析」面板在 L294-339，由父级（controller/个股页）持有 state 驱动。
  - T4.2 新增**独立**「AI 形态解读」面板：解释 detected patterns 在当下量价/趋势语境的含义（如「底背离在中期下行中更可能是反弹而非反转」）。
  - 调用方两个：`StockDetailPage`（L320 传 props）、`FundKlinePatternCard`（从 `useFundDetail()` 取数）。
  - **结论**：卡片自持 `explainPattern` 状态（输入 klineData+patterns 卡片已齐备），对 stock/fund 两页零侵入，不碰 controller/个股页。

## 设置页（T4.3 引导落点）

- 路由 `router.tsx:35` → `{ path: "settings", element: <SettingsPage /> }` → 实际路径 `/settings`。
- `SettingsPage.tsx` 含 AI Provider/apiKey 配置区（L83+）。未配置引导用 `<Link to="/settings">`。

## 现有 analyzeKline 与 T4.2 的边界（避免重复）

- `klineAnalysis.ts` 的 `analyzeKline`：产出 trend + support/resistance + **买卖建议**(advice)，偏交易决策。
- T4.2 `explainPattern`：偏**形态语义解读**（为何这个形态在当下语境是反弹/反转），输入是 detected patterns 列表，输出是人话解释。两者职责正交，可并列共存。

## 关键风险点

- 幻觉风险：Prompt 必须「仅基于给定结构化字段」+ 前端不注入任何非输入数据。缓解：导出 prompt builder 做静态校验（输入字段白名单）。
- 成本/隐私：手动触发 + 不自动刷；仅消费本地已取数据 + 用户自选 LLM，不经过第三方服务端。
