# PENDING_PLAN — 未实现功能统一追踪

> 本文件汇总仓库中**尚未实现**的功能 / 增强 / 待办项，由 `PLAN.md`、`FUTURE_ENHANCEMENTS.md`、`REFACTOR_PLAN.txt`
> 抽取合并而成——这三个源文档已实现的部分保留在代码与 git 历史中，文档本身已删除。
>
> **维护约定**：每完成下面任一 `[ ]` 项，**立即删除对应条目**，并在 commit message 注明
> 「完成 PENDING_PLAN: <标题>」，随 commit 一起提交。

---

## 一、来自 PLAN.md（原完整技术方案，Phase 1–16.6 已全部实现）

仅 Phase 18–19 尚未开始（原描述见 git 历史 `PLAN.md` §七）；下方另含后续提出的决策引擎算法优化（详见独立 plan 文档）：

> **[已验收] Phase 17 — 通知系统增强**：Web Push 定时扫描（Service Worker + `periodicsync` 后台周期扫描，设置项 `notifications.backgroundScan`）与飞书 Webhook 通知均已实现。详见 `README.md`「Web Push 后台定时扫描」一节。提交：`完成 PENDING_PLAN: Phase 17 Web Push 定时扫描`。

### [ ] Phase 18 — 存储扩展：Notion 适配器实现

- **背景**：设置页「存储」Tab 中 Notion 当前灰显「即将推出」。需实现 Notion API 适配器，把持仓 / 投资计划 / 决策日志同步到 Notion 数据库。
- **涉及**：新增 `src/services/notion.ts`、`types` 扩展、`SettingsPage` 解锁开关。

### [ ] Phase 19 — 数据同步：多设备数据同步方案

- **背景**：当前 IndexedDB 仅本地，GitHub Gist 仅做备份导出 / 导入（非实时同步）。需真正多设备同步（冲突合并策略、增量同步）。
- **涉及**：同步引擎 + 设置页「同步」管理。

---

## 二、来自 FUTURE_ENHANCEMENTS.md（未来增强候选）

第一档（纯计算 `indicators`+`signals`）、第二档部分（同类排名 `fund.rankHistory`、资金流板块 `fundFlow.sectorRank`）已接入。
以下候选**尚未实现**（原描述见 git 历史 `FUTURE_ENHANCEMENTS.md`）：

### [ ] 主题基金发现（`sdk.fund.theme(...)`）

- **背景**：按主题分类发现基金，辅助资产配置与自选拓展；尚未接入。

### [ ] 板块行情 / 成分（行业 / 概念）（`sdk.board.industry/*` / `sdk.board.concept/*`）

- **背景**：做板块配置视角。当前仅「板块资金流」面板（`fundFlow.sectorRank`）已接入，板块行情 / 成分尚未。
- **注意**：`board.industry/concept.list()` 直连东财被 CORS 拦，需经已部署的 Worker 反代（见 §三）。

### [ ] 北向 / 沪深港通资金（`sdk.northbound.*`）

- **背景**：北向持仓与流向作为宏观情绪指标；尚未接入 UI（`capitalFlow` 内部仅用到部分）。
- **依赖**：东财，需 Worker 反代（CORS）。

### [ ] 筹码分布 CYQ（`sdk.chips.{cn,hk,us}`）

- **背景**：获利比例 / 成本区间；需东财行情作输入；尚未接入。

### [ ] 交易日历（`sdk.calendar.*`）

- **背景**：交易日判断与提醒调度（部分走网络）；尚未接入。注意 `calendar.marketStatus` 纯时间计算已用于 `MarketStatusBar`，但完整交易日历 / 假期表未接入。

---

## 三、跨模块待办

### [ ] Cloudflare Worker 部署（同花顺 / 巨潮 allowlist 生效）

- **背景**：`worker/index.js` 已含 `*.10jqka.com.cn` + `*.cninfo.com.cn` allowlist，代码已就绪，但用户尚未部署（`wrangler.toml` 缺失 / 未 `wrangler deploy`）。这些源浏览器直连被 CORS 拦截，必须走已部署 Worker 才能取到同花顺 / 巨潮数据。
- **链接**：[cloudflare-worker/README.md](./cloudflare-worker/README.md)、[worker/index.js](./worker/index.js)

---

## 四、已验收：REFACTOR_PLAN.txt 全部落地（无 pending，已删除）

经代码核实，`REFACTOR_PLAN.txt` 的 17 项（P0×4 / P1×9 / P2×4）**已全部实现**，故不抽取、原文档删除：

- **P0-01 / P0-04**：`FundDetailPage` 拆分为 `useFundDetailController` + `fundDetail/*` 子卡片（`FundDetailLayout` 组合，`FundDetailControllerProvider` 提供 Context）。
- **P0-02**：`RankingPage` 拆分为 `useRankingController` + `RankingLayout` / `RankingTable` 等子组件。
- **P0-03**：`EtfMappingManager` 拆分为 `useEtfMappingController` + `etfMapping/*` 子组件。
- **P1-01**：5 个未使用 `@radix-ui` 子包已从 `package.json` 移除。
- **P1-02**：端点集中到 `src/constants/endpoints.ts`。
- **P1-03**：颜色集中 `lib/chart-colors.ts`（多图表已 import）。
- **P1-04**：路由常量 `src/constants/routes.ts` 导出 `ROUTES`，全量替换字面量。
- **P1-05 / P1-06**：数据 hook（`useRealtimeQuotes` 等）+ 状态收敛（`useReducer`）已落地。
- **P1-07**：LLM 封装 / 格式化 / 解析去重（`callLLM`、`lib/format.ts`、`lib/dataTime.ts`）。
- **P1-08**：`PromptTemplateType` 单点定义于 `types/index.ts`。
- **P1-09**：`useLoadOnMount` hook 已落地并复用。
- **P2-01**：`React.memo` 行组件已用。
- **P2-02**：`formatDateOnly`（`lib/dataTime.ts`）统一日期格式。
- **P2-03**：`useDebouncedValue` 复用。
- **P2-04**：`src/constants/` 目录已建立并文档化。
