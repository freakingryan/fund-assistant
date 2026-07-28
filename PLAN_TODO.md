# PLAN_TODO — 待办计划追踪

> 本文件汇总所有**尚未完成**的 plan 项。每完成一项就**立即在此删除对应条目**，并在 commit message 注明「完成 PLAN_TODO: <标题>」。
> 实现的详细方案已迁移进 `PLAN.md` / 各源码模块；已删除的「已实现方案文档」见文末「已清理清单」。

---

## 来源：PLAN.md（完整技术方案 & 进度追踪）

进度表 Phase 1–16.6 全部 ✅，Phase 17–20 待开始。详见 [PLAN.md](./PLAN.md) §七。

### [ ] Phase 17 — 通知系统增强：Web Push 定时扫描 + 飞书通知

- **背景**：当前通知为「浏览器 Push 首发 + 飞书预留」（PLAN §八决策），Phase 4 仅实现浏览器通知 + 计划扫描引擎。需补齐 Web Push 定时扫描（页面关闭也能推送）与飞书 Webhook 推送。
- **链接**：[PLAN.md](./PLAN.md)（Phase 17 行）

### [ ] Phase 18 — 存储扩展：Notion 适配器实现

- **背景**：设置页 Notion 当前灰显「即将推出」；需实现 Notion API 适配器，把持仓/计划同步到 Notion 数据库。
- **链接**：[PLAN.md](./PLAN.md)（Phase 18 行）

### [ ] Phase 19 — 数据同步：多设备数据同步方案

- **背景**：当前 IndexedDB 仅本地，GitHub Gist 仅备份导出/导入。需真正的多设备实时/按需同步方案。
- **链接**：[PLAN.md](./PLAN.md)（Phase 19 行）

### [ ] Phase 20 — 组合风险分析：相关性矩阵 / 行业集中度 / 最大回撤

- **背景**：组合层仅看板汇总，无风险维度。需实现持仓相关性矩阵、行业/主题集中度、组合最大回撤等指标。
- **链接**：[PLAN.md](./PLAN.md)（Phase 20 行）

---

## 来源：FUTURE_ENHANCEMENTS.md（未来增强候选）

第一档（纯计算 indicators+signals）、第二档部分（同类排名/资金面/资金流板块）已接入。剩余候选见 [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md)。

### [ ] 分红派送接入（`sdk.fund.dividendList`）

- **背景**：可获取基金分红送配历史，支撑分红再投资分析；尚未接入 UI。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第二档

### [ ] 主题基金发现（`sdk.fund.theme`）

- **背景**：按主题分类发现基金，辅助资产配置与自选拓展；尚未接入。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第二档

### [ ] 板块行情/成分（行业/概念）

- **背景**：`sdk.board.industry/*` / `sdk.board.concept/*`，做板块配置视角；当前仅板块资金流已接入，板块行情/成分尚未。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第三档

### [ ] 北向 / 沪深港通资金（`sdk.northbound.*`）

- **背景**：北向持仓与流向作为宏观情绪指标；尚未接入 UI（capitalFlow 内部仅用到部分）。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第三档

### [ ] 筹码分布 CYQ（`sdk.chips.{cn,hk,us}`）

- **背景**：获利比例/成本区间；需东财行情作输入；尚未接入。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第三档

### [ ] 交易日历（`sdk.calendar.*`）

- **背景**：交易日判断与提醒调度（部分走网络）；尚未接入。
- **链接**：[FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) 第三档

---

## 来源：REFACTOR_PLAN.txt（重构计划报告）

扫描 120 文件 / 25481 行，发现 17 个问题 P0×4 / P1×9 / P2×4，健康评分 6/10。整体仍大量 pending。详见 [REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt)。

### [ ] P0 — 巨型组件拆分（FundDetailPage / RankingPage / EtfMappingManager）

- **背景**：FundDetailPage(1080行/38 useState)、RankingPage(961行)、EtfMappingManager(806行/15 useState) 违反单一职责，难测难维护。按「控制器 hook + 子卡片组件」拆分。
- **链接**：[REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt) 重构单元 #01/#02/#03

### [ ] P0 — 宽 Props 扇出（FundDetailPage→KlineChartCard→CandlestickChart / DecisionAdvisorCard）

- **背景**：27+ / 33+ props 透传破坏封装，需引入 FundDetailContext 由控制器提供。
- **链接**：[REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt) 重构单元 #04

### [ ] P1 — 移除未使用依赖（5 个 @radix-ui 子包，需用户批准）

- **背景**：package.json 声明但 src 零引用；缩小安装体积。**删除第三方依赖需用户明确批准**。
- **链接**：[REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt) 重构单元 #05

### [ ] P1 — 常量集中 + 重复逻辑去重（端点/颜色/路由常量、LLM/格式化/解析/加载脚手架）

- **背景**：硬编码 API 端点、颜色字面量、路由字面量散落；LLM 封装/百分比金额格式化/时间解析/加载脚手架重复。逐项见重构单元 #06–#13。
- **链接**：[REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt) 重构单元 #06–#13

### [ ] P2 — Quick Win（列表 memo / formatDateOnly / useDebouncedValue 复用 / constants 目录文档化）

- **背景**：低风险局部优化，逐项见重构单元 #14–#17。
- **链接**：[REFACTOR_PLAN.txt](./REFACTOR_PLAN.txt) 重构单元 #14–#17

---

## 跨模块待办

### [ ] Cloudflare Worker 部署（同花顺/巨潮 allowlist 生效）

- **背景**：`worker/index.js` 已含 `*.10jqka.com.cn` + `*.cninfo.com.cn` allowlist，但用户尚未部署本地 Worker。这些源在浏览器直连被 CORS 拦截，必须走已部署的 Worker 才能取到同花顺/巨潮数据（P1-B2 自实现代码已就绪）。
- **链接**：[cloudflare-worker/README.md](./cloudflare-worker/README.md) + [worker/index.js](./worker/index.js)

---

## 维护约定

- 每完成上面任一 todo 项，**立即在本文件删除对应 `[ ]` 条目**，并在 commit message 注明「完成 PLAN_TODO: <标题>」。
- 新增计划时，先在对应「来源」段追加条目，落地实现后随 commit 删除。
- 本文件随每次相关 commit 一起提交；非源码文件，不进入 husky 类型/ESLint 门禁。

---

## 已清理（已实现的方案文档，已从仓库删除）

- `task_plan.md` / `findings.md` / `progress.md`（投资体检 SOP 向导，已 commit `33c7a05`+`ed33a24`）
- `.planning/2026-07-20-backtest-ai-analysis/task_plan.md`（回测 AI 分析，Phase 全 ✅）
- `docs/task_plan.md` / `docs/findings.md` / `docs/progress.md` / `docs/plan-factor-improvements.md`（评分引擎因子增强 A→D+Worker ✅）
- `stock-sdk-migration-plan.md`（迁移 P0–P5 ✅）
- `P1-B2-allowlist-gap.md`（P1-B2 同花顺/巨潮 fund-assistant 自实现 ✅）
