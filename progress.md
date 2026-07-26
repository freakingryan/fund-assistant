# Progress — 同花顺/巨潮(互动易) 自实现 + 多通道通知契约

## 2026-07-26 会话开始

- 用户前提澄清：stock-sdk 是 clone 的第三方 repo，不可 push。确认此前孤儿 commit 已 reset，clone 干净。
- 用户决策：在 fund-assistant 内自实现同花顺/巨潮(互动易)，并启动多通道通知契约+噪声控制。
- 已加载 frontend-quality-workflow → planning-with-files，建立 task_plan.md / findings.md / progress.md。
- 调研完成：4 个端点（同花顺 EPS/热榜/题材归因、巨潮互动易两步 POST）、Worker allowlist、现有 proxy 注入模式、现有 notifications 配置（browser/feishu 已存在）。
- 待办：Phase A0 起手，先跑 baseline tsc 确认悬空 researchReport.ts 是否破坏编译。

## 2026-07-26 实现完成（Feature A + Feature B）

### Feature A — 同花顺/巨潮(互动易) 自实现

- A0：新增 `src/services/proxyFetch.ts`（`PROXY_HOST_RE` 覆盖 eastmoney|10jqka.com.cn|cninfo.com.cn + `buildProxyFetch`）；重构 `eastmoneySdk.ts` 复用；`worker/index.js` ALLOWED_HOST_RE 加两域。
- A1：`src/services/extraSources/tonghuashun.ts`（getConsensusEps 走 worth.html GBK 依赖无关抽取 / getHotList / getThemeAttribution）+ 类型。
- A2：`src/services/extraSources/cninfo.ts`（getIrmQa 两步 POST）。
- A3：`MarketPage` 接入 `ConsensusEpsPanel` / `HotListPanel` / `IrmPanel` + `ExtraSourceGuard`；`SettingsPage` 加「同花顺/巨潮增强」开关；`dataSource.extraSources` 配置 + 默认值。
- tsc + vite build 绿。

### Feature B — 多通道通知契约 + 噪声控制

- B0：`NotificationChannel` / `NotificationNoiseConfig` 类型；`settings.notifications` 改为 channels/feishuWebhook/noise。
- B1：`src/services/notify.ts` 统一入口 `notify()`，噪声闸门（安静时段/类型免打扰/去重/最小间隔/频率限制）+ 通道分发（inApp/browser/feishu best-effort）。
- B2：迁移 `autoSync`/`App.tsx`/`PlansPage` 到 `notify()`；`notification.ts` 删除废弃 `sendAlert*`。
- B3：`SettingsPage` 通知频道开关 + 飞书 webhook + 噪声控制 UI；`NotificationsPage` 新增「应用内通知」列表（标已读/删除/清空）。
- tsc + vite build 绿。

### 质量关

- `tsc --noEmit` 0 error；`vite build` 成功（仅历史 chunk 体积警告）。
- pre-commit (husky) 按用户极简偏好未安装，以手动门禁替代。
- 规划文件 task_plan.md / findings.md / progress.md 留于仓库根（未跟踪，可清理）。
