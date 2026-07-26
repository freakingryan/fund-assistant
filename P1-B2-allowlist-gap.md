# P1-B2 — 同花顺 / 互动易（巨潮）数据域 Worker allowlist 缺口 Spec

> **状态：已搁置（DEFERRED，2026-07-26 用户决策）。**
> stock-sdk 是第三方只读上游（`chengzuopeng/stock-sdk`），用户无法 push；本轮在本地 clone 上做的 `293eaaa`(研报)/`bc804f1`(同花顺) 两个 commit 已 `git reset --hard origin/master` 丢弃，**未进入任何已发布包**。
> 结论：fund-assistant 作为 npm 消费方只能用官方 `stock-sdk@2.4.0`，其中无研报/同花顺 service。P1-B2 暂缓，待 (a) stock-sdk 官方发布相关 service 后升级依赖，或 (b) 改为 **fund-assistant 自实现** / fork stock-sdk。
> 本文件保留作**端点调研参考**（同花顺/巨潮域名、CORS/Worker 分析、互动易=巨潮修正），但「stock-sdk 上游已补全」前提已不成立。

---

## 0. 关键修正（务必先读）

用户原话「同花顺 / 互动易域」把两者归为同花顺，但实际：

| 数据源                        | 真实域                                            | 端点（来自 a-stock-data/SKILL.md）                                                                                        |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 一致预期 EPS                  | **同花顺** `*.10jqka.com.cn`                      | `https://basic.10jqka.com.cn/new/{code}/worth.html`（HTML/GBK）                                                           |
| 人气热榜                      | **同花顺** `*.10jqka.com.cn`                      | `https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour\|day&list_type=normal`（JSON） |
| 题材归因（涨停揭秘/异动原因） | **同花顺** `*.10jqka.com.cn`                      | `http://zx.10jqka.com.cn/event/api/getharden/date/{date}/...`（JSON）                                                     |
| 互动易（投资者问答）          | **巨潮 cninfo** `*.cninfo.com.cn`（**非同花顺**） | `cninfo` 互动易 API（`a-stock-data/SKILL.md` L112 `cninfo_irm`）                                                          |
| 东财人气榜                    | 东财 `emappdata.eastmoney.com`                    | `https://emappdata.eastmoney.com/stockrank/getAllCurrentList`（POST JSON）                                                |

⇒ **互动易 ≠ 同花顺**，它属于巨潮（cninfo）域。本次 P1-B2 实际要覆盖**两个新域**：

- `*.10jqka.com.cn`（同花顺：EPS / 热榜 / 题材归因）
- `*.cninfo.com.cn`（巨潮：互动易）

⇒ 东财人气榜（`emappdata.eastmoney.com`）**已在 Worker allowlist 内（东财域）**，无需改动。

---

## 1. stock-sdk 上游已完成（commit `bc804f1`）

位于 `Documents/coding/stock-sdk`，本地领先 origin/master 2 个 commit（`293eaaa` 研报 + `bc804f1` 同花顺），**均未 push / 未发版**。

- `src/core/providerPolicy.ts`：`ProviderName` 联合类型新增 `'tonghuashun'`；`inferProviderFromUrl` 新增 `if (host.includes('10jqka.com.cn')) return 'tonghuashun';`
- `src/providers/tonghuashun/eps.ts`：`consensusEps(code)` — `worth.html` 走 `client.get(url,{responseType:'arraybuffer'})` → `decodeGBK` → 依赖无关表格抽取（正则/行扫描取「每股收益/均值」表），零 HTML 解析依赖。
- `src/providers/tonghuashun/hot.ts`：`hotList({type:'hour'|'day'})` + `themeAttribution({date})` — JSON 端点，防御性取数（多 envelope 形态兼容）。
- `src/types/tonghuashun.ts` / `sdk/tonghuashunService.ts` + 门面 `get tonghuashun`（5 处导出点注册：providers/index、types/index、sdk/index、sdk.ts、src/index）。
- 集成测试桩 `test/integration/providers/tonghuashun/*.int.test.ts`（`RUN_INTEGRATION=1` 门控，跳过）。
- `website/summary.md` 新增「同花顺数据（tonghuashun）」小节。
- 质量门：`tsc --noEmit` 0 error（tsup 因沙箱删 dist 被拦截，未跑；类型校验已通过）。

**消费方约束（调用方负责）**：同花顺反爬需 Referer，由用户在 `new StockSDK({ providerPolicies: { tonghuashun: { headers: { Referer: 'https://basic.10jqka.com.cn/' } } } })` 注入。`providerPolicies` 在 SDK 构造时由调用方传入（stock-sdk 不带硬编码默认）。

---

## 2. fund-assistant 消费侧缺口（需落地）

### 2.1 Worker allowlist（用户自部署环境）

Worker 当前只透传东财子域（`*.eastmoney.com`）。需新增两条放行规则（仅透传、不写解析逻辑，与 §7.4 原则一致）：

```
ALLOWED_HOSTS = [
  '*.eastmoney.com',
  '*.10jqka.com.cn',   // ← 新增：同花顺（EPS/热榜/题材归因）
  '*.cninfo.com.cn',   // ← 新增：巨潮互动易
]
```

要点：

- **同花顺 EPS 是 GBK 二进制**（`worth.html`）。Worker 必须**原样透传 arraybuffer**，不得 `utf-8` 解码/转码；fund-assistant 侧用 stock-sdk 的 `decodeGBK`（`TextDecoder('gbk')`）解码。
- 同花顺 HTTP 接口含 `http://`（题材归因 `zx.10jqka.com.cn`），Worker 侧若强制 https 需做 30x 改写或内部升级，避免浏览器混合内容阻断。
- 继续沿用「托管 stock-sdk 的 Node 端」范式：Worker 不应手写任何同花顺/巨潮解析，仅把请求转发到上游并回传原始 body。

### 2.2 fund-assistant `EASTMONEY_HOST_RE` 正则扩展

`src/services/eastmoneySdk.ts` L13：

```ts
const EASTMONEY_HOST_RE = /^https?:\/\/([^/?#]+\.)*eastmoney\.com/i;
```

改为同时识别同花顺与巨潮，使 `proxyFetch` 也能改写这两个域的请求到 Worker：

```ts
const PROXY_HOST_RE = /^https?:\/\/([^/?#]+\.)*(eastmoney\.com|10jqka\.com\.cn|cninfo\.com\.cn)/i;
```

并同步把 `EASTMONEY_HOST_RE` 的所有引用（L30 判定 + L35 改写）改为 `PROXY_HOST_RE`。**语义不变**：直连模式下仍直连（当前网络东财已可达，同花顺/巨潮是否可达需实测——若浏览器 CORS 失败则必须走 proxy）。

> 注意：fund-assistant 走同花顺/巨潮时，需 new 一个**独立 StockSDK 实例**并传入 `providerPolicies.tonghuashun.headers`（Referer），不能复用 `buildEastmoneySdk`（它不注入同花顺 Referer，且 `EASTMONEY_HOST_RE` 旧正则不识别 10jqka/cninfo）。建议新增 `buildTonghuashunSdk(config)` / `buildCninfoSdk(config)` 构造器，复用同一套 direct/proxy 逻辑。

### 2.3 接入范式（沿用 P0-C / P1-A 三件套）

新增数据接入 = 三件套（与现有市场页一致）：

1. `src/services/*.ts` 封装（复用 `buildTonghuashunSdk`/`buildCninfoSdk` + 导出 re-export `EastmoneyDisabledError` 三态，门控开关建议新增 `settings.dataSource.tonghuashun.enabled` / `settings.dataSource.cninfo.enabled`）。
2. UI 卡（如 `ConsensusEpsCard` / `HotListCard` / `IrmCard`），复用 `EastmoneyDisabledError` 三态降级。
3. 路由 / 导航注册（如挂到 `/market` 或新建 `/sentiment` 页）。

---

## 3. 落地顺序建议

1. **Worker**：加 `*.10jqka.com.cn` + `*.cninfo.com.cn` 到 allowlist，确保 GBK arraybuffer 原样透传、http→https 升级。
2. **fund-assistant 代码**：扩展 `PROXY_HOST_RE`；新增 `buildTonghuashunSdk`/`buildCninfoSdk` 构造器 + providerPolicies Referer；新增设置开关。
3. **stock-sdk 发版**：push `293eaaa`+`bc804f1`、提 PR、发 `^2.5.0`；fund-assistant 解除 `npm link`、改 `"stock-sdk": "^2.5.0"`。
4. **UI 接入**：三件套接线（EPS 卡 / 热榜卡 / 互动易卡），接 `EastmoneyDisabledError` 降级。
5. **验证**：`RUN_INTEGRATION=1` 跑通同花顺集成测试桩；fund-assistant `tsc`/`eslint`/`vite build` 全绿。

---

## 4. 不在 P1-B2 范围

- 限售解禁预警：stock-sdk 暂无 service，本轮不做（§7.3）。
- 东财人气榜：已在 allowlist 内，直接走 stock-sdk 现有东财 service，无需改动。
- 涨停揭秘池：`data.10jqka.com.cn`（JSON，同花顺域）——与热榜同域，可顺带接入，但非 P1-B2 核心，留作后续。

---

## 5. 关联文档

- 上游实现：`Documents/coding/stock-sdk`（commit `bc804f1`）
- 能力评估：`/Users/murnysaul/WorkBuddy/2026-06-13-10-40-04/a-stock-data-evaluation.md` §7.3 / §7.6（P1-B2 行）
- 现有代理：`fund-assistant/src/services/eastmoneySdk.ts`、`fund-assistant/worker/index.js`（若本地有）
- 合规原则：a-stock-data-evaluation.md §7.4（Worker 托管 stock-sdk，不写解析逻辑）
