# Findings — 同花顺/巨潮(互动易) 自实现 + 多通道通知契约

> 工作目录：`fund-assistant/`（唯一可维护 repo）。stock-sdk 为第三方只读依赖，保持 npm 上 v2.4.0，不参与改动。

## 1. 为什么在 fund-assistant 自实现（而非 stock-sdk）

- stock-sdk (`chengzuopeng/stock-sdk`) 不可 push；v2.4.0 既无研报也无同花顺/巨潮 service。
- 用户硬性原则「不写东财/腾讯 fetch+解析」针对的是**东财/腾讯**；同花顺/巨潮无库覆盖，自实现**不违反**原则。
- 用户决策（本轮）：在 fund-assistant 内自实现同花顺/巨潮，并启动通知契约+噪声控制。

## 2. CORS / Worker 反代（必读）

- fund-assistant 是浏览器 SPA；直连 `*.10jqka.com.cn` / `*.cninfo.com.cn` / `*.eastmoney.com` 都会被 **CORS** 拦截（与网络是否可达无关）。
- 现有 `worker/index.js`（在 fund-assistant 内，用户可改）是 CORS 反代：浏览器→Worker（带 `x-upstream-host` 头）→Worker 服务端抓取上游→回传并加 `Access-Control-Allow-Origin: *`。
- Worker 当前 `ALLOWED_HOST_RE = /([^/?#]+\.)*eastmoney\.com$/i`，**只放行东财**。需扩到 `10jqka.com.cn` + `cninfo.com.cn`。
- fund-assistant 端 `EASTMONEY_HOST_RE` 只改写东财 host；需泛化为 `PROXY_HOST_RE` 覆盖三域，并经同一 `x-upstream-host` 机制走 Worker。

## 3. 端点（权威来源：Documents/coding/a-stock-data/SKILL.md）

### 同花顺（10jqka.com.cn）

- **一致预期EPS**：`GET https://basic.10jqka.com.cn/new/{code}/worth.html`
  - 响应 HTML/GBK；headers 需 `Referer: https://basic.10jqka.com.cn/`。
  - 解析：取含「每股收益」字样的表格 → 列：年度 / 预测机构数 / 最小值 / 均值 / 最大值（「均值」= 一致预期EPS）。
  - 依赖无关抽取：fetch `arraybuffer` → `new TextDecoder('gbk').decode()` → 正则/行扫描定位表格（不可引 cheerio）。
- **人气热榜**：`GET https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour|day&list_type=normal`
  - JSON；`data.stock_list[]`：rank/code/name/heat(人气值)/pct/rank_chg/concepts(概念标签)/tag。`type` 可选 hour/day。
- **题材归因**：`GET http://zx.10jqka.com.cn/event/api/getharden/date/{date}/orderby/date/orderway/desc/charset/GBK/`
  - JSON；`data[]` 每只股票 reason 题材标签。date=YYYY-MM-DD。

### 互动易（巨潮 cninfo.com.cn）

- `cninfo_irm(code)` 两步 POST：
  - Step1 `POST https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo` body `{"keyWord": code}` → `data[0].secid` = orgId。
  - Step2 `POST https://irm.cninfo.com.cn/newircs/company/question` **params 必须放 query string（body 空）** → `rows[]`：stockCode/companyShortName/mainContent(提问)/attachedContent(回复, 可能 null)/pubDate(毫秒时间戳)/answerer。
  - 坑：orgId 取自 step1 的 secid；最新提问常未回复；时间是毫秒。

## 4. 现有通知系统（自实现契约的基础）

- `stores/notifications.ts`：`AppNotification{id,type,title,body,createdAt,read}` + zustand store（addNotification/markRead/...）。仅被 bell 徽标 (`AppLayout`) 与 `autoSync` 消费，**未在 NotificationsPage 展示**。
- `services/notification.ts`：浏览器 Notification API（`requestNotificationPermission`/`sendNotification`/`sendAlertNotification`/`sendAlertBatch`）。
- `stores/settings.ts` 已有 `notifications: { browser: true, feishu: false, schedule: '0 20 * * 1-5' }` —— **多通道已初具配置形态**（browser/feishu），但无统一调度器、无噪声控制。
- `NotificationsPage.tsx` 当前展示的是 `usePlansStore.alerts`（投资计划提醒），与 in-app store 是**两套独立体系**。
- 结论：契约层 = 新增 `notify(input)` 调度器，路由到 inApp(必走) + browser(开关/权限) + feishu(可选 webhook)，并施加噪声控制；把现有 `autoSync`/`sendAlert*` 调用迁移到 `notify()`。

## 5. 现有 proxy 注入模式（复用）

- `src/services/eastmoneySdk.ts` `buildEastmoneySdk(config)`：mode='proxy' 时构造 `proxyFetch`，对 `EASTMONEY_HOST_RE` 命中的 url 注入 `x-upstream-host` 头并改写到 `proxyUrl`。
- 消费方：`marketBreadth/dragonTiger/sectorStrengthAnalysis/marketSentiment/northbound/capitalFlowAnalysis/fundRankHistory/researchReport/sectorFundFlowRank` 等（均 `useSettingsStore.getState().settings.dataSource.eastmoney`）。
- 计划：把 `EASTMONEY_HOST_RE`/`proxyFetch` 抽成 `src/services/proxyFetch.ts` 的 `buildProxyFetch(config)`，三域通用；`buildEastmoneySdk` 内部复用它（最小改动）。同花顺/巨潮 service 也用同一个 `buildProxyFetch`。

## 6. 风险/待确认

- 悬空代码：`researchReport.ts`/`ResearchReportCard.tsx`/`FundDetailLayout.tsx` 改动（研报层 UI）**未提交**，依赖 stock-sdk 的 `report` service（v2.4.0 无）→ 可能令 `tsc` 失败。Phase 0 先验证 baseline，必要时临时回退该 UI 保绿（研报层已搁置）。
- feishu webhook 浏览器直发受 CORS 限制；做 best-effort（try/catch），失败静默。
