# 观点回测（Insights Backtest）— 需求澄清结论与技术方案

> 本文档由 grill-me 阶段产出：6 个顶层决策分支已全部锁定。Phase 1 Step 2（planning-with-files）落盘。

## 一、需求澄清结论（grill-me 决策表）

| #   | 分支                      | 决策                                                                                                                                                                                    | 理由                                                                                                                     |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | 内容获取方式              | **ima `import_urls`(BYOK) 抓公众号/网页正文；纯文本粘贴保留作降级**                                                                                                                     | 微信/小红书浏览器端 CORS+反爬无解；ima 服务端自动抓取，免去自建爬虫 Worker。BYOK（用户自带 key）与现有 AIProvider 同模式 |
| 2/3 | AI 引擎 + 抽取 + 主题映射 | **ima 只当「取数源」；分两种形态收敛到同一 `directions[]`：①ima 已出分析结论 → 只做轻量方向抽取成卡片；②原始观点 → 跑 `callAI` 完整抽取。两者都经 `themeMappings` 落到可回测 ETF/指数** | 要可控 schema（方向/主题/理由），不重复 ima 已给的结论；映射策略沿用此前确认的 A（主题→代表标的表）                      |
| 4   | 存储与按日回看            | **新建 IndexedDB：`insights`(v13) + `themeMappings`(v14)，按日期组织**                                                                                                                  | 本地优先、零后端；按 `date` 字段索引做时间线/回看                                                                        |
| 5   | 回测命中定义              | **T+5 期末收盘判定；买中上涨 / 卖中下跌 = 命中；按需回测；数据走 stock-sdk ETF/指数 K 线**                                                                                              | 直观可复现；聚合单条/按日/按主题命中率 + 累计收益曲线                                                                    |
| 6   | 界面与导航                | **独立侧边栏导航项「观点回测」(`/insights`)，三视图：录入 / 按日时间线 / 回测面板**                                                                                                     | 不与现有 `/backtest`(策略回测) 混淆；独立工作流                                                                          |

**跨分支约束（用户原话）：「结合当日市场动向」** → 录入时**自动抓相关 ETF + 大盘快照**作为 AI 上下文，并随记录持久化，回看可复现。

## 二、关键技术发现（ima OpenAPI）

通过 web 核实（2026-07-31），ima 确有开放 API，能力覆盖本功能最硬的两块：

- **`import_urls`**：服务端自动抓取 `mp.weixin.qq.com` 等文章完整正文（无需浏览器介入 / 不怕 CORS / 反爬）。微信文章稳；小红书 best-effort（XHS 反爬强，可能失败，需降级到「粘贴正文」）。
- **AI 分析/语义搜索**：知识库 `search_knowledge`、文章 `get_media_info` 等。
- **认证**：请求头 `ima-openapi-clientid` + `ima-openapi-apikey`（或版本差异的 `X-Client-Id` / `X-Api-Key`）。在 `ima.qq.com/agent-interface` 生成，**密钥只显示一次，且部分来源称有效期约 1 个月**（需提示用户定期刷新）。

### ⚠️ 必须正视的架构约束（已与用户确认采用 BYOK）

fund-assistant 是**纯静态 SPA、零后端**。ima API 要求：①保密钥；②浏览器跨域大概率被拦。

- **BYOK 解决密钥**：用户在设置页填自己的 ima `clientId/apiKey`（与现有 OpenAI key 同待遇，存本地 IndexedDB）。这是用户自己的 key、自己的账号、自己的设备 —— 风险模型与现有 AI key 一致。
- **CORS 兜底**：若 ima 不允许浏览器 CORS，则经 Phase 17 已规划的 **Cloudflare Worker 反代**（用户可选填 `proxyUrl`）。Worker **不持密钥**，仅转发 + 补 CORS 回包；key 始终从浏览器发出。
- **设计目标**：优先直连（若 CORS 允许），失败再走代理；两种都支持，不强依赖任一。

### 已存在资源（直接复用，不重复造）

- `services/ai.ts` `getDefaultAI()` / `callAI()` —— 浏览器直连 AI，零后端，复用设置页 `aiConfigs`。
- `services/pwa/scanCapabilities.ts` `fetchTencentKline` / `periodToCount` —— SW 安全的 K 线取数（回测复用）。
- `src/constants/routes.ts` + `AppLayout.tsx` + `src/router.tsx` —— 导航/路由注册位。
- `EtfMappingManager` —— `themeMappings` UI 可复用其形态。
- `db.ts` 当前 v12（quoteCache/swMeta）。新表需 v13、v14。

## 三、数据模型（拟实现）

```ts
// 列表卡片单元：一条投资方向（ima 已分析 或 AI 抽取 都收敛到这里）
interface InvestmentDirection {
  id: string;
  theme: string; // "半导体材料设备" / "MLCC" / "双创50指数"
  direction: "buy" | "sell" | "hold";
  brief: string; // 一句话操作建议，如 "底部横盘磨底，性价比突出，可逢低布局"
  level?: string; // 可选：结构级别，如 "60分钟上涨结构" / "周线上涨趋势"
  mappedCodes: string[]; // themeMappings 落到的 ETF/指数代码（回测用）
  hit?: boolean; // 回测后填充
  returnPct?: number; // 回测后填充 T+5 区间收益%
}
interface MarketSnapshot {
  date: string;
  indexes: { code: string; name: string; pct: number }[]; // 沪深300/中证全指
  relatedEtfs: { code: string; name: string; pct: number }[]; // 当日相关 ETF 涨跌
}
interface Insight {
  id: string;
  date: string; // 观点所属交易日 YYYY-MM-DD
  createdAt: number;
  mode: "ima-analyzed" | "raw-text"; // ima 已出分析结论 vs 原始观点待分析
  sourceType: "text" | "url" | "ima";
  url?: string;
  blogger?: string;
  fullText: string; // ima 分析全文 or 原始粘贴（详情页 markdown 渲染展示）
  directions: InvestmentDirection[]; // 列表卡片数据（核心展示单元）
  marketSnapshot: MarketSnapshot; // 录入时抓的相关 ETF+大盘快照
  aiAdvice?: string; // 仅 raw-text 模式由 callAI 产出；ima-analyzed 留空（fullText 即结论）
}
// themeMappings: id=主题关键词, codes=代表 ETF/指数代码[] ；UI 可编辑，预置常见主题
```

## 三（补）、ima 已分析形态（用户补充 · 2026-07-31）

用户指出关键使用场景：使用 ima 时，用户**往往已让 ima 结合市场动向与博主观点做过一轮分析**，ima 返回的就是「分析后的结论」而非原始正文。此时本功能只需：

1. 从 ima 返回文本中**抽取具体投资方向**（主题 + 买卖建议 + 一句话理由）；
2. 以**卡片形式 + 日期**共同展示在列表上；
3. 点击 → 查看**完整分析内容**（ima 原文）。

### 两种输入形态（决定走哪条分析链路）

- **Case A · ima 已分析（`mode="ima-analyzed"`）**：ima 返回结构化的投资方向叙事（见下方「典型形态」）。我们**只做轻量方向抽取** → 产出 `directions[]` 卡片；`fullText` 存 ima 原文；`aiAdvice` 留空（全文即结论）。**不再跑完整 callAI 分析**（避免重复，且 ima 已给结论）。
- **Case B · 原始观点（`mode="raw-text"`）**：纯文本 / 未分析正文。跑 `callAI` 完整抽取 `directions[]`（含 level / 置信度推理）+ `aiAdvice`。

两条链路最终都收敛到 `directions[]` + `fullText`，UI 与回测口径完全统一。

### 典型形态（ima 已分析返回样例，来自用户）

> 创业板/半导体/科创芯片已形成 120/60 分钟上涨结构，短期企稳。可关注：
>
> - **MLCC**：确定性最高，沿半年线爬升，跌幅超 60%，建议分批建仓。
> - **半导体材料设备**：底部横盘磨底，60 分钟上涨结构，跌幅 30%-40%，可逢低布局。
> - **AI 应用（云计算/软件）**：日线上涨结构，可能反转，中长线配置。
> - **互联网（腾讯/阿里）**：周线上涨趋势，长期持有或回调加仓。
> - **双创 50 指数**：宽基，回调约 30%，有望反弹 25%，适合不折腾的投资者。
>   操作：先建 1/4 底仓，观察次日回踩，不破再加；CPO/通信暂观望；整体控制仓位，注意风险。

抽取目标：把每个「- 主题：」块抽成一张方向卡片（`theme`/`direction`/`brief`/`level`），末尾「操作总策略 + 风险提示」作为该 Insight 附注（存 `fullText` 尾部或独立 `note` 字段）。`direction` 由「分批建仓/逢低布局/持有/加仓」等映射为 buy/hold。

### 对 UI 的影响（修订分支 6）

- **时间线列表**：按 `date` 分组，每条 Insight 渲染其 `directions[]` 为**方向卡片**（主题 + 买卖徽标 + 一句话建议）；卡片与日期同屏展示。
- **详情**：点击 → `fullText`（markdown 渲染的 ima 分析全文）+ `marketSnapshot`（当日相关 ETF/大盘）+ 方向卡片列表。
- 回测面板不变（仍基于 `directions[].mappedCodes`）。

## 三（补2）、ima OpenAPI 能力核实（2026-07-31 二次查证）

为回答「ima 具体提供什么 API、能实现什么」，对 ima 开放能力做了一轮核实，结论如下：

### 认证形态

- **OpenAPI（官方、BYOK 友好）**：所有请求带两个自定义 Header `ima-openapi-clientid` + `ima-openapi-apikey` + `Content-Type: application/json`，**不是**标准 Bearer/OAuth。密钥在 `ima.qq.com/agent-interface` 生成，仅显一次、约 1 月有效期。
- **Cookie 认证（逆向 Web 客户端）**：部分端点（如问答）走 `x-ima-cookie` + `x-ima-bkn`，需登录会话 Cookie，**不适合 SPA BYOK**，脆弱、不纳入设计。

### OpenAPI 官方能力（仅"取数 + 检索 + 笔记"，无生成式分析）

- **知识库 `/openapi/wiki/v1/`**：
  - `import_urls` — **服务端自动抓取公众号/网页正文并入库**，批量 1–10 个 URL，自动识别类型；返回 `results`: URL→{ret_code, media_id}。**（我们功能的核心取数入口）**
  - `search_knowledge` — 知识库内语义搜索，返回 `info_list`：`title` / `highlight_content`（高亮片段）/ `media_id` / `parent_folder_id`。**返回"命中文档+片段"，非生成式答案**。
  - `get_media_info` — 按 `media_id` 取访问信息：网页/文章类返回 `url_info.url`（**签名短链，需再 fetch 一次才拿到正文**）；笔记类（media_type 11）自动附 `note_content` 正文。
  - `get_knowledge_list` / `get_knowledge_base` / `search_knowledge_base` / `get_addable_knowledge_base_list` — 浏览/详情/列表检索。
- **笔记 `/openapi/note/v1/`**：`import_doc`（建笔记）/ `get_doc_content`（读正文）/ `append_doc`（追加）/ `list_note_by_folder_id` / `search_note_book`。

### 关键纠正：ima OpenAPI **不暴露**"生成式分析/问答"端点

- 生成式"知识库问答/结合观点分析"的能力（`/cgi-bin/assistant/qa`，SSE 流式）**仅存在于 Cookie 认证的 Web 客户端路径**，不在 OpenAPI key 体系内。
- 含义：ima 在我们要做的功能里**只能当"取数源 + 语义检索"**——抓公众号/网页正文、按主题搜历史观点。**真正的"结合当日市场+观点→投资建议"的分析，仍由 fund-assistant 用现有 `callAI` 做，或用户在 ima GUI 分析完把结论贴回（即 Case A）**。这与已设计的双形态方案完全自洽，且不依赖任何 ima 生成式能力。

### 路径/调用坑（务必记牢）

- 官方 OpenAPI 前缀为 **`/openapi/wiki/v1/`** 与 **`/openapi/note/v1/`**；旧博客写的 `/wiki/v1/`、`/api/v1/` 会 **401**。
- `Content-Type` 必须显式 `application/json`，缺失也被拒。
- `import_urls` 上限 10 URL；`get_media_info` 返回的 `url_info.url` 为短期签名链，取正文需二次请求。

## 三（补3）、「从 ima 自动获取投资意见」可行性（2026-07-31 用户澄清工作流）

用户实际工作流：读公众号 → 分享到 ima 让 ima 调 AI 结合市场分析出投资意见 → 意见留在**会话历史** →（可选）存知识库。目标：fund-assistant 能否**自动**从 ima 取到该意见并整理+回测。

### 关键限制：ima OpenAPI 读不到「会话历史」

- 核实：ima 官方 OpenAPI 能力边界仅到**知识库 + 笔记**（skill 配置页「核心功能」明确列：读取/写入/检索笔记、检索/导入知识库、获取文件与网页链接，**无"读取会话历史/对话记录"**）。
- 搜索引擎返回的"会话历史 API"均属腾讯云/飞书/阿里等他产品，与 ima 无关；**未发现 ima 经 OpenAPI(BYOK key) 暴露读对话历史的端点**。
- 唯一对话相关生成式接口 `/cgi-bin/assistant/qa` 走 **Cookie 认证**（登录会话），不在 OpenAPI key 体系 → SPA 无法干净 BYOK，脆弱、不纳入设计。

### 结论：把"存知识库"由可选升为同步前提

- 投资意见若只在会话历史，fund-assistant **取不到**；必须先落到**知识库**，OpenAPI 才能读。
- 故用户工作流的步骤 4（保存到知识库）应**常规化**，并建议存进一个专用「投资观点」KB/文件夹，便于 fund-assistant 按范围同步。
- **【用户确认 · 2026-07-31】存储目标明确为「知识库」（非笔记）**：`syncFromImaKb` 仅实现知识库路径（`search_knowledge` + `get_media_info`），**不做笔记分支**（`/openapi/note/v1/` 系列不纳入）。设置项只需 `kbId`（知识库 ID）+ 可选 `kbFolderId`（文件夹 ID），无需笔记相关配置。

### 改造后自动工作流（成立版）

```
ima 侧：读公众号 → ima 结合市场分析出投资意见 → 【常规】存到「投资观点」KB/文件夹
fund-assistant 侧：配置 ima key(BYOK) → 点「从 ima 同步」
  → search_knowledge(scoped 到「投资观点」KB/文件夹，可按时间窗/游标增量)
  → get_media_info 取回完整分析文本
  → extractDirections(Case A 轻量抽方向) → 存 Insight(带日期) → 回测
```

### 取数层两种路径（并存）

1. **自动同步（用户目标，首选）**：`search_knowledge`(scoped) → `get_media_info`。意见已存知识库时走此路，零手动粘贴。
2. **URL/文本兜底**：贴 URL → `import_urls` → `get_media_info`；或直接用粘贴文本。适用于未存库或临时拉新文。

### 不采用 Cookie 抓会话历史

逆向 Cookie 调对话历史：① 需登录会话 cookie 非 key，脆弱易失效；② 违背"用户自带 key、零后端"干净架构；③ ima 改版即断。明确放弃，以"存知识库"为同步前提。

## 四、风险与待验证项

1. **ima 端点/密钥头存在版本差异**（`/openapi/wiki/v1/...` vs `/api/pub/copilot/...`；`ima-openapi-*` vs `X-Client-Id`）。P1 必须含**连通性探测**，并提示用户按其 ima 账号实际字段校正。
2. **密钥有效期约 1 个月** → UI 需提示「失效请重新生成」。
3. **小红书抓取可能失败** → 优雅降级到文本粘贴，并记录 `sourceType`。
4. **回测数据缺口**：若某 ETF/指数在 T~T+5 无交易（停牌/新上市），需跳过或标记。
