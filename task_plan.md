# Task Plan — 同花顺/巨潮(互动易) 自实现 + 多通道通知契约

> 流水线：frontend-quality-workflow（planning-with-files → task-implement → impeccable → code-simplifier → 质量门）。
> 仅改动 `fund-assistant/`；stock-sdk 保持只读 v2.4.0。

## Goal

1. **Feature A**：在 fund-assistant 内自实现同花顺（一致预期EPS / 人气热榜 / 题材归因）与互动易（巨潮）数据源，经现有 Worker 反代打通 CORS，并落地「市场情绪」UI 三件套。
2. **Feature B**：统一多通道通知契约（`notify()` 调度器，路由 inApp/browser/feishu）+ 噪声控制（安静时段 / 类型免打扰 / 去重 / 频率限制），迁移现有调用方。

## Phases

### Feature A — 同花顺/巨潮

- [x] **A0** Proxy 基础设施泛化
  - `src/services/proxyFetch.ts`：新增 `PROXY_HOST_RE`（eastmoney|10jqka.com.cn|cninfo.com.cn）+ `buildProxyFetch(config)`（注入 `x-upstream-host`，三域通用）。
  - 重构 `eastmoneySdk.ts` `buildEastmoneySdk` 复用 `buildProxyFetch`（最小改动）。
  - `worker/index.js`：`ALLOWED_HOST_RE` 加 `10jqka.com.cn` + `cninfo.com.cn`。
- [x] **A1** 同花顺 service + 类型
  - `src/services/extraSources/tonghuashun.ts`：`getConsensusEps`(worth.html GBK 依赖无关抽取) / `getHotList`(JSON) / `getThemeAttribution`(JSON)；注入同花顺 Referer。
  - `src/types/index.ts`：加 `TonghuashunEps` / `TonghuashunHotItem` / `ThemeItem`。
- [x] **A2** 互动易(cninfo) service + 类型
  - `src/services/extraSources/cninfo.ts`：`getIrmQa(code)` 两步 POST（params 放 query string）。
  - `src/types/index.ts`：加 `CninfoIrmItem`。
- [x] **A3** UI — 市场情绪页
  - `src/components/sentiment/SentimentPage.tsx` + 三卡：`ConsensusEpsCard`(按代码) / `HotListCard`(全局) / `IrmCard`(按代码)。
  - 设置开关：dataSource 下加 `extraSources.enabled`（默认 false，需 proxy 模式）；SettingsPage 加开关 + 说明。
  - 路由注册（router.tsx / 导航）。
- [x] **A4** 校验：`tsc --noEmit` 绿（vite build 在 Phase 5 质量门统一跑）。

### Feature B — 多通道通知契约 + 噪声控制

- [x] **B0** 类型/配置扩展
  - `NotificationChannel = 'inApp' | 'browser' | 'feishu'`；`NotificationNoiseConfig { quietHoursStart, quietHoursEnd, typeOptOut[], dedupWindowMin, minIntervalSec, maxPerMinute }`。
  - 扩 `settings.notifications`：`channels?: NotificationChannel[]`（默认 ['inApp','browser']）、`feishuWebhook?: string`、噪声字段；`defaultSettings` 补齐。
- [x] **B1** 调度器 + 噪声逻辑
  - `src/services/notify.ts`：`notify(input)` → 先过噪声控制 → 按 channels 分发（inApp 写 store；browser 走 Notification API；feishu best-effort POST）。
  - 噪声：安静时段、类型免打扰、去重（type+title 在窗口内合并）、最小间隔、频率限制（环形缓冲）。
- [x] **B2** 迁移调用方
  - `autoSync.ts` 的 `addNotification` → `notify()`；`notification.ts` 的 `sendAlertNotification/sendAlertBatch` → 经 `notify()`。
  - 保留 `requestNotificationPermission`/`sendNotification` 作为底层原语。
- [x] **B3** 设置 UI
  - `NotificationsPage.tsx` 增加「通知偏好」区：通道开关 / 安静时段 / 类型免打扰 / 去重窗口 / feishu webhook。
  - 合并展示 in-app store 通知 + 计划提醒时间线（可选，二选一或并排）。
- [x] **B4** 校验：`tsc --noEmit` + `vite build` 绿。

### Phase 5 — 质量关（共享）

- [x] **C0** impeccable：SentimentPage 三卡响应式/间距/空态；通知偏好区 a11y。
- [x] **C1** code-simplifier：单函数 <50 行、≤4 参数、early return、去重；同花顺/巨潮解析抽取复用（ExtraSourceGuard 三卡复用）。
- [x] **C2** 质量门：`tsc --noEmit` 与 `vite build` 全绿（pre-commit 钩子按用户极简偏好不自动安装，以手动门禁替代）。

## Decisions

- 同花顺/巨潮不进 stock-sdk；在 `src/services/extraSources/` 自实现，复用 `buildProxyFetch`。
- 新增数据源默认关闭（需 proxy 模式 + Worker allowlist），避免直连 CORS 报错污染主流程。
- feishu 通道 best-effort（浏览器直发可能受 CORS 限制），失败静默。

## Errors Encountered

| Error                                                                | Attempt | Resolution                                                            |
| -------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| (baseline) researchReport.ts 可能引用 v2.4.0 不存在的 report service | 0       | Phase A0 先跑 baseline tsc，若失败则临时回退该悬空 UI（研报层已搁置） |
