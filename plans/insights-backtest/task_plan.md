# 观点回测（Insights Backtest）— 实施计划

> 编排：grill-me(需求打磨) → 本文档(planning-with-files) → task-implement → impeccable → code-simplifier → setup-pre-commit
> 质量门：eslint 0 error + `tsc` + `vite build` 全绿；husky 提交门；**不 push 待授权**。

## 目标

新增「观点回测」功能：用户粘贴博主投资观点（公众号/小红书链接经 ima 抓取，或纯文本），AI 结合当日市场动向抽取结构化信号并给投资建议；按日期回看；对历史观点做 T+5 回测与命中率分析。

## 路由与导航

- 新路由 `/insights`（不与现有 `/backtest` 策略回测冲突）。
- 侧边栏新增「观点回测」项（`src/constants/routes.ts` + `AppLayout.tsx`）。
- 页面内三视图（Tab 或子路由）：`/insights`(录入) · `/insights/timeline`(时间线) · `/insights/backtest`(回测)。

---

## P0 — 类型与存储骨架

- [x] `types/index.ts`：增 `Insight` / `InvestmentDirection` / `MarketSnapshot` / `ThemeMapping` / `ImaConfig`；`UserSettings` 增 `ima: ImaConfig`。
- [x] `stores/settings.ts`：默认 `ima: { enabled:false, clientId:"", apiKey:"", kbId:"", kbFolderId:"", proxyUrl:"" }`。（**用户已确认存知识库，不存笔记；故仅 `kbId` + 可选 `kbFolderId`，无笔记相关配置**）
- [x] `stores/db.ts`：`version(13)` 增 `insights: "id, date, createdAt, sourceType"`；`version(14)` 增 `themeMappings: "id"`。
- [x] `themeMappings` 预置：半导体/新能源/医药/消费/军工/券商/红利/创业板/沪深300 → 代表 ETF/指数代码（复用现有 ETF 池）。

## P1 — 取数层（ima / 市场快照 / AI 抽取）

- [x] `services/ima.ts`：两条取数路径并存 ——
  - **自动同步（用户目标·首选）** `syncFromImaKb(imaCfg, { sinceTs? })`：调 ima `get_knowledge_list`（scoped 到 `imaCfg.kbId` / 可选 `kbFolderId`，可按时间窗增量）→ 对每个命中 `media_id` 调 `get_media_info` 取回完整分析文本 → 返回 `{ mediaId, title, text }[]`。**前提：用户须将 ima 对话"保存到知识库"的「投资观点」KB**。
  - **URL 抓取（兜底）** `fetchArticle(url, imaCfg)`：ima `import_urls` + `get_media_info`（按 `clientId/apiKey` 带头）；若设 `proxyUrl` 改 POST 代理（仅转发+补 CORS，不持密钥）；返回 `{ markdown }`；失败抛可识别错误（CORS/抓取失败/key 失效）。
  - 两者都含 `probeConnection(imaCfg)` 连通性探测（先用 `get_addable_knowledge_base_list` 验证 key 可达）。
- [x] `services/insightMarket.ts`：`buildMarketSnapshot(date, mappings)` —— 调腾讯 K 线（`fetchTencentKline`，浏览器直连 CORS*）取沪深300/中证全指当日涨跌 + 各主题映射 ETF 当日涨跌。
- [x] `services/insightAnalysis.ts`：
  - `extractDirections(text, mappings)` —— **轻量方向抽取**（Case A / ima 已分析）：从 ima 返回的分析结论里捞 `InvestmentDirection[]`（主题/方向/一句话建议/结构级别），主题经 `themeMappings` 回填 `mappedCodes`；不重跑完整分析。
  - `analyzeInsight(raw, snapshot, mappings, aiCfg)` —— **完整抽取**（Case B / 原始观点）：用 `callAI` 做结构化抽取（JSON schema 约束：directions[] + aiAdvice），主题经 `themeMappings` 回填 `mappedCodes`。
  - 两函数都收敛到 `Insight.directions[] + fullText`。

## P2 — 录入视图 + 编排

- [x] `components/insights/InsightInputView.tsx`：
  - **「从 ima 同步」按钮（首选）**：点 → `syncFromImaKb` 拉回未同步的投资意见列表 → 逐条 `extractDirections`(Case A) → 按各自日期存 Insight。
  - 文本域 + URL 输入 + 「用 ima 抓取」开关（需 ima 启用）+ 日期选择；点「分析」→ 编排 `buildMarketSnapshot → (ima?fetchArticle) → 按 mode 选 extractDirections / analyzeInsight → db.insights.add`，写 `mode` 字段。
  - 加载态 / 错误提示 / 降级（ima 失败时提示改贴文本或检查是否已"存到知识库"）。

## P3 — 按日时间线 / 回看视图

- [x] `components/insights/InsightTimelineView.tsx`：日历 + 按 `date` 分组列表；每条 Insight 渲染其 `directions[]` 为**方向卡片**（主题 + 买卖徽标 + 一句话建议），卡片与日期同屏展示；点开 → 详情（`fullText` markdown 全文 + `marketSnapshot` 当日相关 ETF/大盘 + 方向卡片列表）。

## P4 — 回测引擎 + 面板

- [x] `services/insightBacktest.ts`：`runBacktest(filter)` —— 对每个 signal 取映射标的 T~T+5 K 线（`fetchTencentKline`），算 T+5 期末收益；`hit = (buy&&>0)||(sell&&<0)`（hold 计中性/排除）；聚合：单条命中、按日命中率、按主题命中率、累计收益曲线数据。
- [x] `components/insights/InsightBacktestView.tsx`：日期范围/主题筛选 + 结果表 + 命中率卡片 + Recharts 累计收益曲线 + 数据缺口标记。

## P5 — 接入导航 + 文档

- [x] `router.tsx` 注册 `/insights*`；`routes.ts` + `AppLayout.tsx` 加侧边栏项。
- [x] `README.md`：补「观点回测」说明（ima BYOK 配置、回测口径、限制）。
- [x] `PENDING_PLAN.md`：标记本功能进入实施（删除对应 `[ ]` 条目）。

## P6 — 质量门与提交

- [ ] eslint 0 error；`tsc`；`vite build` 全绿。
- [ ] 本地 commit（husky 门通过）；**不 push，待用户授权**。

---

## 验收标准

1. 粘贴文本 → 分析 → 生成信号 + 建议 + 当日市场快照，存入并可按日回看。
2. 配置 ima key 后，**点「从 ima 同步」可自动拉回已存知识库的对话投资意见并整理**（前提：用户在 ima 侧将对话"保存到知识库"）；贴公众号链接亦可经 ima 抓正文（CORS 失败时走代理或降级提示）。
3. 回测面板对任意历史日期区间，输出命中率与累计收益曲线，数据与腾讯 K 线一致。
4. 纯静态 SPA、零后端；ima key 仅存本地；无密钥泄漏。
