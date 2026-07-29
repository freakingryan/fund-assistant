# 基金投资助手

跨平台（Web + PWA）基金持仓管理与投资决策辅助工具。纯前端、零后端、纯静态部署。

## 功能总览

### 📊 持仓管理

- **添加基金** — 手动批量录入（多行表单，两种持仓输入方式：成本×份额 / 金额+收益）
- **编辑基金** — 修改任意字段（代码、名称、成本、份额、类型、领域、标签等）
- **快速调仓** — 补仓（按金额/份额，自动获取最新净值计算加权成本）/ 减仓（按份额/金额/比例，含 1/2、1/3 等预设）
- **批量删除** — 表格复选 + 一键删除
- **数据导入** — CSV/Excel 文件导入（自动映射列名）+ AI 截图识别导入
- **自动分类** — 根据基金代码和名称自动识别：市场（A股/港股/美股）、类型（股票型/混合型/债券型/指数型/QDII/货币型/ETF）、领域（科技/消费/医药/新能源/金融/制造/宽基/全球/债市/大宗商品/地产）
- **快速查询** — 输入基金代码，自动补全名称、类型、投资领域、ETF 映射（带 IndexedDB 缓存）
- **股票/ETF 搜索** — 添加基金时支持关键词搜索（如输入"半导体"搜索到半导体ETF），点击搜索结果自动添加

### 📈 数据看板

- **摘要卡片** — 总市值、持仓盈亏、收益率、今日涨跌、基金数量
- **图表分析** — 类型分布饼图（Recharts）、领域分布柱状图
- **TOP 10 持仓** — 持仓金额排行
- **投资计划提醒** — 待处理提醒的面板集成

### 🔍 基金详情页

- **K 线走势** — 纯 SVG 蜡烛图，支持场内 ETF 真实 K 线（OHLC + 成交量）与 NAV 折线切换；**默认展示「基金净值走势」，可手动切换至场内 ETF 真实 K 线**；场内 ETF 真实 K 线获取失败会自动切换为「基金净值走势」并同步开关状态
- **技术指标叠加** — MA5/MA10/MA20/MA60 均线 + BOLL(20,2) 布林带，可切换显示
- **K 线形态检测** — 三层算法引擎自动识别 14 种单 K + 6 种多 K 组合形态，AI 深度分析；**默认（基金净值走势）模式下整体隐藏 K 线形态分析，仅展示场内 ETF 真实 K 线时显示**
- **综合评分** — 多指标融合信号评分（MA/MACD/RSI/Bollinger/形态/量能），权重公开可调；**净值走势模式下标注「基于净值走势、置信度较低」（缺失形态与量能信号，仅趋势类指标有效）**
- **重仓股穿透** — 前十大重仓股及占比
- **Prompt 生成** — 三种模板：持仓诊断 / 调仓建议 / K 线增强，一键复制
- **缓存智能过期** — K 线/行情/基金信息按 A 股交易时段自动刷新，盘尾段手动刷新
- **更新时间显示** — 各卡片标题旁显示「更新于 HH:MM」

### ⚙️ 投资计划

- **规则引擎** — 全局规则，所有基金共用：收益率触发、净值价差触发、单日涨跌幅触发、定期定投、K 线形态 AI 诊断
- **手动扫描** — 点击"检查"遍历所有持仓，匹配规则生成提醒
- **提醒面板** — 待处理提醒列表，支持「快速调仓」「已执行」「已读」
- **操作日志** — 历史提醒记录
- **浏览器通知** — 扫描触发时推送（应用打开时）
- **Web Push 后台定时扫描** — 设置页「后台定时扫描」开启后，即便页面/标签关闭，Service Worker 仍会周期（Chromium 约 12h+）扫描投资计划并弹出系统通知。详见下方「Web Push 后台定时扫描」一节。

### 🎯 Prompt 生成器

- 多选持仓 → 选择模板 → 一键生成结构化的 AI 投资分析 Prompt
- 支持诊断/调仓/K 线增强三种专业模板
- 与投资计划联动（调仓模板自动包含触发规则信息）

### 🔌 数据源架构（双第三方库结合，零自管取数逻辑）

数据获取已迁移到两个第三方库，**移除了项目自维护的 fetch / JSONP / 重试 / 限流 / 熔断代码**——重试、限流、超时、多源兜底全部交给两库各自的内部治理：

| 库                                | 覆盖域 | 支持功能                                                                          | 底层源                                                                                             |
| --------------------------------- | ------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **stock-api**（v2.7，内置零配置） | 股票域 | 股票/ETF **实时行情**、**场内 ETF / 个股 K 线**（OHLC+成交量）、股票/ETF **搜索** | 腾讯 `web.ifzq.gtimg.cn` / `qt.gtimg.cn`（默认腾讯→新浪→东财，浏览器构建自带 JSONP 兜底绕开 CORS） |
| **stock-sdk**（v2.4，内置零配置） | 基金域 | 基金 **净值历史**、**估值**、**基金行情**、**F10 重仓**、**基金信息**             | 东方财富 `fund.eastmoney.com/pingzhongdata`、`fundgz.1234567.com.cn`                               |

**双库重叠项（K 线 / 股票行情 / 股票搜索）优先级**：`stock-api`（主，用户网络可达的腾讯源）→ `stock-sdk`（兜底），由极薄的 `withCrossLibFallback` helper 仅做 try/catch 编排。**基金域接口 `stock-api` 无覆盖，直连 `stock-sdk`**，并保留旧的东方财富 fundgz / pingzhongdata JSONP 作为兜底（东财恢复 / 开 VPN 即自动复活）。

> **零后端、零配置**：所有数据均在浏览器前端直接获取，无需运行任何额外服务。
>
> ⚠️ **网络前提**：`stock-sdk` 全部基金接口底层走**东方财富**。若你的网络无法访问东方财富（`push2his` / `pingzhongdata` / `fundf10`），则基金净值历史 / 持仓将暂不可用（K 线 / 股票行情 / 搜索走腾讯源不受影响）；此为网络可达性问题，非代码问题，恢复访问后自动复活。

### 🛰️ K 线 / 行情数据源详解（两库内部治理，非自管）

股票 / ETF 的 K 线、实时行情、搜索全部通过 **`stock-api`** 库获取；基金净值 / 估值 / F10 通过 **`stock-sdk`** 库获取。**项目本身不再实现任何 fetch / JSONP / 重试 / 限流 / 熔断逻辑**——这些请求治理全部由两个库各自的内部实现负责。

**为什么改用第三方库（而非自维护 JSONP）？**

- 历史实现里 K 线走自写的 `<script>` JSONP + 三源兜底 + 手写熔断/限流。JSONP 的硬伤是**看不到 HTTP 状态码**，无法区分「被限流 429」和「网络错误」，只能盲目重试 → 越重试越被限流（恶性循环）。
- `stock-api` 用 `fetch` 直连、能感知状态码，内置 `retries` + `AbortController` 干净超时 + 多源兜底（默认 `腾讯 → 新浪 → 东财`）；浏览器构建**自带 JSONP 适配**，腾讯源不开放 CORS 时自动降级。K 线主源 `web.ifzq.gtimg.cn` 在国内网络可达。
- `stock-sdk` 同样用 `fetch` 直连，能对 429/5xx 做指数退避 + jitter 重试、令牌桶限流、多 host 兜底、熔断，覆盖基金全维度。

**双库分工与重叠兜底：**

| 域     | 主库          | 覆盖                                    | 重叠兜底                                                                        |
| ------ | ------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 股票域 | **stock-api** | K 线 / 股票·ETF 行情 / 搜索             | 失败时回退 **stock-sdk** 对应方法（`withCrossLibFallback` 极薄 try/catch 编排） |
| 基金域 | **stock-sdk** | 净值历史 / 估值 / 基金行情 / F10 / 信息 | stock-api 无基金能力，回退**旧东财 fundgz / pingzhongdata JSONP**               |

> ⚠️ **场外→场内 ETF 映射**是两库均不提供的能力，保留项目自有的一小段启发式逻辑（非网络请求）。

**如果看到 K 线 / 净值空白：**

- 股票 / ETF K 线走腾讯源，通常可达；偶发失败由 `stock-api` 内部重试 + 多源兜底自动处理，多刷新即可。
- 基金净值历史 / 估值 / 搜索走东方财富（`pingzhongdata` / `fundgz` / `fundsuggest`，均**不校验 Referer**）：若你的网络无法访问东方财富，将暂时空白（属网络可达性问题）；**恢复访问 / 开 VPN / 开 Clash 系统代理后自动复活**（这些接口用 `<script>` JSONP 由浏览器直发，请求会走系统代理）。

> ⚠️ **基金持仓明细（F10）的特殊限制**：`fundf10.eastmoney.com` **强制校验 Referer 必须为 `*.eastmoney.com`**，且无 CORS、无 JSONP callback。浏览器 JS 无法伪造跨域 Referer，因此 **纯静态生产环境（如 GitHub Pages）无法直接获取持仓明细**——即使开了代理、东财可达也不行（Referer 反爬与网络无关）。
>
> - **开发环境**：由 Vite dev proxy 注入 eastmoney Referer 转发，东财可达（或开 Clash **TUN 模式**让 Node 请求也走代理）时正常显示。
> - **生产环境**：持仓明细优雅降级（返回空）；如需生产可用，须自行部署边缘代理（Cloudflare Worker / Vercel Edge Function）转发并设置 Referer。

**📦 K 线缓存过期策略（交易时段感知，项目自有缓存层保留）：**

- **交易时段内**（9:30–11:30 / 13:00–15:00，周一至周五）：缓存较短 TTL（默认 30 分钟，受周期上限约束，1m 更短），使当日 K 线能反映盘中变动。
- **交易时段外**（收盘后 / 非交易日 / 周末）：缓存使用「距离下一交易时段开盘」的长 TTL，**收盘价一旦确定便不再变化，缓存基本不失效**，直到次日开盘才刷新——既省请求又保证数据正确。
- 缓存存于 IndexedDB，刷新 / 重开应用后仍然命中。

**⚡ 后台静默预热（预取 K 线）：**

- 应用打开、标签页重新可见、以及每 20 分钟，会**静默预取所有基金的「基金净值走势」**；此外仅对**基金名称含「ETF / 指数」且已配置 ETF 映射**的基金，额外预取「场内 ETF 真实 K 线」，写入与详情页共用的缓存键。
- 纯场外主动基金不预取真实 K 线（无真实 K 线意义，且默认即展示净值走势），避免无谓打接口 / 触发限流。
- 预热前先检查缓存是否存在及最后更新时间，**新鲜则跳过**；并重用底层请求防护（内存缓存 + 同码去重 + 并发限流 3 + 源熔断），每条之间再加 500ms 间隔，几乎不会触发限流。
- 效果：进入基金详情页 / 切换基金、或手动切换「场内 ETF 真实 K 线」时直接命中缓存，**无需漫长加载**。
- 可在「设置 → 云端同步」卡片内用「后台预取 K 线」开关关闭（默认开启）。

### 🤖 AI 功能

- **6 种 AI 平台** — DeepSeek / Google AI Studio / OpenAI / Groq / OpenRouter / 自定义 API
- **截图识别** — AI Vision API 从持仓截图提取基金信息
- **ETF 映射查询** — 自动查询场外→场内对应关系
- **连接测试** — 验证 API Key 有效性
- **不配置也**不影响核心持仓功能

### 🧠 智能决策建议引擎（算法优化 T1–T5）

决策建议卡（`DecisionAdvisorCard`，位于个股 `/stock/:code` 与基金 `/detail/:id` 详情页）在纯技术面动量融合之上，叠加资金/板块语境与护栏，输出诚实、可解释的动作建议：

- **核心护栏（T1）**：资金流背离 / 板块逆风 / 中期趋势门控三道护栏，下跌市不误触发「买入」；短翻多标注为「反弹（reversion）」而非「趋势确认」，区分反弹与反转语义。
- **风险画像（T2，只读）**：波动分档（年化波动 / 最大回撤 / ATR%）+ 建议最大单标的仓位 + 止损参考，纯展示、不改动作。
- **校准卫生（T3）**：买入阈值诚实化（恢复 `score>=70 && bullRatio>=0.6`，不再为回测覆盖放宽）；联接基金（CIS）按 NAV vs ETF 跟踪误差做置信折扣。
- **AI 解释层（T4，需配置 AI）**：`aiAdvisor` 运行时把引擎结构化输出 + 市场快照解释为「人话研判」（`adjudicateDecision`），并对 K 线形态做可读解读（`explainPattern`）；未配置 AI 时 UI 引导去设置页。
- **AI 调参反馈环（T5，需配置 AI）**：决策权重/阈值外置为 `decisionParams`（默认逐字节等价）；AI 仅产出白名单内结构化参数 diff，经**人审「采纳」**才写入并即时生效。回测页「AI 调参」面板（`/backtest`）展示当前参数、待审提案对比、采纳历史与一键回滚；满足条件（新增 ≥20 已结算样本或 ≥7 天）自动生成**待审**提案（绝不自动采纳）。

> 设计详述见 [PLAN-decision-optimization.md](./PLAN-decision-optimization.md)；`verify-decision.mts`（仓库根）用真实引擎在 Node 直跑，做零回归验证。

### 💾 数据持久化

- **IndexedDB 本地存储**（Dexie.js），清除浏览器数据会丢失
- **多层缓存** — K 线/行情/基金信息/ETF 映射，含 A 股交易时间智能过期策略
- **数据备份** — 导出/导入 JSON 文件
- **云端同步** — GitHub Gist（推拉双向同步，上传内容已自动剥离 Token / API Key / Notion 密钥等凭据）
- **每日自动同步** — 设置页「每日自动同步」开关开启后，应用启动及每 6 小时会检查并自动推送到 Gist（距上次成功≥24h 才推送，失败 6h 内不重试）；推送成功后在右上角铃铛浮窗中展示通知
- **应用内通知** — 顶部栏深色模式按钮旁新增铃铛按钮，未读数以红点徽标显示；点击展开浮窗查看未读消息列表，支持单条标记已读 / 全部已读
- **数据源状态面板** — 设置页一键检查 stock-api / fundgz / pingzhongdata 可用性和延迟

### 🎨 用户体验

- **亮/暗/跟随系统** 三种主题模式（深色/浅色全适配）
- **PWA** — 可安装到桌面/手机主屏幕，离线可用
- **响应式布局** — 桌面侧边栏 + 移动端抽屉导航，支持手机/平板/折叠屏
- **触屏优化** — K 线图完全触屏支持（Tap 选中/高亮/关闭），底部信息栏零遮挡
- **快捷主题切换** — 顶部栏主题切换按钮（浅色/深色/跟随系统）
- **全局搜索** — 顶部栏搜索框，输入关键词快速搜索基金/ETF，直达持仓管理
- **通知** — 浏览器推送通知（Service Worker）；Web Push 后台定时扫描（见下）

### 🛰️ Web Push 后台定时扫描（Phase 17）

让投资计划提醒**脱离「页面必须打开」的限制**：开启后，即便标签关闭，Service Worker 也会在后台周期扫描持仓并弹出系统通知。

**工作原理**

- 扫描核心抽离为纯函数 `evaluatePlanRules`（`src/services/plans/scanCore.ts`），前台 `plans.ts` 与后台 `sw.ts` 共用同一套规则语义，确保前后台判定一致。
- 后台（SW）不依赖 DOM：行情取自 IndexedDB `quoteCache` 表（由前台每次扫描写入的最新快照）；可选填入「行情代理地址」（Cloudflare Worker 反代）以在页面关闭时拉取最新行情。
- 经 `vite-plugin-pwa` 的 `injectManifest` 注入自定义 SW（`src/pwa/sw.ts`）：监听 `periodicsync` 事件驱动 `runBackgroundScan()`，噪声控制与「仅交易时段 / 免打扰」等闸门在后台完整复刻。
- 启用 `trend` 趋势规则需行情代理（SW 内无 DOM 无法跑 ETF K 线计算），未配置时代码优雅跳过该规则。

**启用步骤**

1. `npm run build && npm run preview`（或部署到 HTTPS 静态托管，SW 仅在 production 构建生效）。
2. 设置页「通知 → 后台定时扫描」打开开关，授权浏览器通知。
3. 可选：填入 Cloudflare Worker 反代地址（获取最新行情 / 启用趋势规则）。

**验证**

- Chromium 内核浏览器（Chrome / Edge），打开 DevTools → Application → Service Workers，确认 `sw.js` 已注册且状态 `activated`。
- `chrome://serviceworker-internals` 确认 `periodicsync` 已注册（`tag: plan-background-scan`，最小间隔约 12h）。
- 关闭标签页，等待后台触发（Chromium 实际间隔由浏览器策略控制，可能长于 12h；可用 DevTools 的「Periodic Sync」调试按钮强制触发）。
- 触发后即便页面未打开，也会弹出系统通知；点击通知跳转到对应基金提醒页。

**限制**

- **仅 Chromium 内核支持** Periodic Background Sync（Firefox / Safari 不支持；Safari 仅支持 Push API 但无周期同步）。不支持的浏览器开关会提示并优雅降级。
- 浏览器对后台扫描频率有最终控制权，不保证精确周期。

**vite-plugin-pwa 配置注意（injectManifest 坑）**

- `injectManifest` 策略下，workbox-build 只读取 VitePWA 配置的 `injectManifest` 键；放在 `workbox` 键里的选项（如 `maximumFileSizeToCacheInBytes`）**不会生效**，会导致默认 2 MiB 预缓存上限报错。
- 本仓库主 bundle 含 react-markdown 等，体积 >2MiB，必须在 `injectManifest` 键下显式设 `maximumFileSizeToCacheInBytes`（已设为 6MiB）。`globPatterns` 同样放在 `injectManifest` 键。
- 本版本 workbox-build 的 `InjectManifest` schema 仅接受有限选项：`cleanupOutdatedCaches` / `navigateFallback` / `runtimeCaching` 均属 generateSW-only，放在 `injectManifest` 键下会被 `WorkboxConfigError` 拒绝。

## 技术栈

| 类别       | 选择                                                                            | 版本                  |
| ---------- | ------------------------------------------------------------------------------- | --------------------- |
| 框架       | React + TypeScript + Vite                                                       | v19 + v6 + v8         |
| UI         | Tailwind CSS + shadcn/ui                                                        | v4 + 17 个 Radix 组件 |
| 状态管理   | Zustand                                                                         | v5                    |
| 本地存储   | Dexie.js (IndexedDB)                                                            | v4                    |
| 路由       | React Router                                                                    | v7                    |
| PWA        | vite-plugin-pwa + Workbox                                                       | v1                    |
| 图表       | Recharts + 纯 SVG                                                               | v3                    |
| 表格       | TanStack Table                                                                  | v8                    |
| CSV/Excel  | PapaParse / xlsx                                                                | —                     |
| **数据源** | **stock-api**（股票域：K线/行情/搜索） + **stock-sdk**（基金域：净值/估值/F10） | v2.7 + v2.4           |
| 代码质量   | ESLint + TypeScript                                                             | v10 + v6              |
| CI/CD      | GitHub Actions (quality + deploy)                                               | —                     |

## 快速开始

### 前置要求

- Node.js 22+
- npm 10+

### 安装 & 运行

```bash
# 1. 克隆仓库
git clone https://github.com/freakingryan/fund-assistant.git
cd fund-assistant

# 2. 安装依赖（--force 解决 peer dep 冲突）
npm install --force

# 3. 开发模式
npm run dev
# 默认 http://localhost:5173，Vite 支持 HMR
```

### 构建 & 预览

```bash
npm run build        # 类型检查 + 构建，输出到 dist/
npm run preview      # 本地预览构建结果
npm run lint         # ESLint 代码检查
```

### 数据源（零配置）

应用内置 **stock-api**（股票域：K线/行情/搜索，腾讯源）+ **stock-sdk**（基金域：净值/估值/F10，东方财富源）两个第三方库，零配置即用，无需任何 Token。请求的重试 / 限流 / 超时 / 多源兜底全部由两库内部治理，项目不再自维护 fetch/JSONP 逻辑。

### 配置 AI（可选）

设置 → AI 平台 → 选择提供方 → 填写 API Key → 测试连接。

可用平台：DeepSeek / Google AI Studio / OpenAI / Groq / OpenRouter / 自定义。

### 配置 Gist 云端备份（可选）

备份数据（基金持仓 + 投资计划 + 所有配置）到 GitHub Gist，换设备可直接恢复。

#### 1. 创建 GitHub Token

1. 打开 https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 名称填 `fund-assistant`，过期时间选 **No expiration**
4. 勾选权限：**`gist`**（只需这一个）
5. 生成并复制 Token（以 `ghp_` 开头）

#### 2. 备份到云端（旧设备）

```
设置 → 备份 → GitHub Gist
1. 粘贴 Token
2. 点击「推送到 Gist」
3. 看到 ✓ 已同步到 Gist (xxx) 即完成
```

> Gist ID 会自动保存，后续再次推送会更新同一份数据。

#### 3. 从云端恢复（新设备）

```
设置 → 备份 → GitHub Gist
1. 粘贴**同一个 Token**
2. 直接点击「从 Gist 恢复」← 无需先推送
3. 系统自动搜索你的 Gist 列表找到备份
4. 确认恢复后页面自动刷新，所有数据还原
```

> 如果系统提示「未找到备份 Gist」，确认旧设备已推送到 Gist，且使用的是同一个 GitHub 账号的 Token。

## 项目结构

```
fund-assistant/
├── index.html
├── package.json
├── vite.config.ts
├── eslint.config.js
├── tsconfig.json
├── verify-decision.mts   # 真实决策引擎零回归验证（Node 直跑，无需浏览器）
├── PLAN-decision-optimization.md  # 决策引擎算法优化：设计 + T1–T5 实施记录
├── .github/workflows/
│   ├── deploy.yml        # GitHub Pages 部署（quality → build → deploy）
│   └── quality.yml       # PR/push 时运行 ESLint + tsc + build
├── src/
│   ├── main.tsx           # 入口
│   ├── App.tsx            # 根组件（主题切换 + 通知权限 + Error Boundary）
│   ├── router.tsx         # 路由定义（13 条路由）
│   ├── index.css          # Tailwind + CSS 变量
│   ├── components/
│   │   ├── ui/            # 17 个 shadcn/ui 组件
│   │   ├── layout/        # AppLayout（侧边栏 + 顶部栏 + Outlet）+ InstallPrompt
│   │   ├── dashboard/     # DashboardPage, CandlestickChart, FundDetailGateway
│   │   ├── holdings/      # HoldingsPage/Table, Add/Edit/Import/FundDetail/QuickAdjust Dialog
│   │   │                  #   + DecisionAdvisorCard(决策建议卡) / AiAdvisoryPanel(AI解释) / KlinePatternCard
│   │   ├── backtest/      # BacktestPage（回测 + AI 分析 + AI 调参反馈面板）
│   │   ├── plans/         # PlansPage（规则配置 + 提醒面板 + 操作日志）
│   │   ├── prompts/       # PromptsPage（三种模板生成器）
│   │   └── settings/      # SettingsPage（7 个 Tab）+ NotificationsPage
│   ├── stores/            # Zustand stores: holdings, plans, settings + Dexie db
│   ├── services/          # ai.ts, aiAdvisor.ts(AI解释层), backup.ts, klineCache.ts
│   │                      # klinePatterns.ts, klineAnalysis.ts, technicalIndicators.ts
│   │                      # signalEngine.ts, notification.ts, prompt.ts
│   │   ├── decision/      # decisionEngine(决策真相源) + decisionParams(可配置权重/阈值)
│   │   │                  #   + riskProfile(风险画像) + trackingError(联接基金折扣)
│   │   └── backtest/      # decisionSnapshot(决策→实际结果账本) + tuningProposal(AI调参反馈环)
│   ├── adapters/datasource/ # base.ts（接口）+ stockSdkAdapter.ts（统一适配器：stock-api 股票域 + stock-sdk 基金域）
│   │                        # + crossLibFallback.ts（极薄跨库兜底）+ stock-api.ts / eastmoney.ts / jsonp-utils.ts（东财 fundgz/pingzhongdata 兜底）+ service.ts
│   ├── lib/               # classification.ts, utils.ts
│   └── types/             # index.ts（全部 TS 类型定义）
```

## 常见问题

| 问题                      | 解决                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EBADENGINE` / TLS 错误   | 命令前加 `NODE_OPTIONS=""`                                                                                                                                                                                                                         |
| `ERESOLVE` 依赖冲突       | 使用 `npm install --force`                                                                                                                                                                                                                         |
| 端口被占用                | Vite 自动切换到下一个可用端口                                                                                                                                                                                                                      |
| 数据存在哪里？            | 浏览器 IndexedDB，清除浏览器数据会丢失                                                                                                                                                                                                             |
| 需要数据库或后端？        | 不需要，纯前端应用。股票/ETF 走 **stock-api**（腾讯源），基金净值/估值/F10 走 **stock-sdk**（东方财富源），请求治理由两库内部负责                                                                                                                  |
| ETF K 线显示空白？        | K 线走腾讯源，偶发失败由 stock-api 内部重试 + 多源兜底自动处理，刷新即可；若长时间空白多为本机 IP 被临时限流（数小时~1 天恢复）或网络受限，切换网络即可                                                                                            |
| 基金净值/估值/搜索空白？  | 走东方财富（用户网络 2026-07-19 实测直连可达，无需代理）；若空白多为东财接口偶发限流，刷新或切换网络即可恢复                                                                                                                                       |
| 基金持仓明细（F10）空白？ | `fundf10` 强制校验 eastmoney Referer，浏览器无法伪造 → 纯静态生产（GitHub Pages）仍受 Referer 跨域限制无法直接取（与东财网络是否可达无关）；开发环境走 Vite proxy 注入 Referer 可用；如需生产可用需自建边缘代理（Cloudflare Worker）转发设 Referer |

## 部署

`npm run build` 后的 `dist/` 目录可部署到任何静态托管服务：

- GitHub Pages（[playbook](./.github/workflows/deploy.yml) 已配好，push 到 main 自动部署）
- CloudStudio Pages
- EdgeOne Pages
- Vercel / Netlify

## 目录结构与开发约定

> 纯前端 SPA（React + TS + Vite）。以下为源码目录约定，便于一致维护与快速定位。

### 路径别名

- `@/*` → `./src/*`（见 `tsconfig.app.json` 的 `paths`）。所有源码 import 使用 `@/` 绝对路径，避免 `../../../` 相对路径漂移。
- 因此 `@/lib` 与 `@/constants` 均指向 `src/` 下对应目录。

### `src/lib/` — 通用工具层（等同 `utils/`）

该目录等价于常见的 `utils/` 层，**沿用 `@/lib` 别名，不强制改名为 `utils/`**（改名会引发 `@/lib → @/utils` 的大规模 import 改动，收益不足以覆盖成本）。每个文件单一职责：

| 文件                 | 职责                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `utils.ts`           | `cn()` className 合并（clsx + tailwind-merge），全站最基础工具                                                                        |
| `format.ts`          | 数值/货币/百分比格式化（`formatSigned`/`formatPercent`/`formatCurrency`/`formatMoneyCompact`）、持仓市值/成本/盈亏计算                |
| `labels.ts`          | 中文本地化字典：`TYPE_LABELS` / `SECTOR_LABELS` / `MARKET_LABELS`                                                                     |
| `chart-colors.ts`    | 图表配色常量（涨红跌绿 `UP_COLOR`/`DOWN_COLOR`、均线色、类型色）                                                                      |
| `classification.ts`  | `autoClassify(code, name)` 自动识别市场/类型/领域                                                                                     |
| `fundCategory.ts`    | ETF 判定（`isOnExchangeEtfFund` 等）                                                                                                  |
| `holdingCost.ts`     | 持仓成本解析（`resolveHoldingCost`、`ResolvedCost`、`CostMethod`）                                                                    |
| `dataTime.ts`        | 时间解析与格式化（`parseToTs`、`formatDateOnly`/`formatDateTime`/`formatTimeOnly`、`resolveAsOf`、`asOfFromKlines/Quotes/Portfolio`） |
| `tradingCalendar.ts` | 交易日历（`isTradingDay`/`isMarketHoliday`/`isWeekend`、`MARKET_HOLIDAYS_BY_YEAR`）                                                   |
| `json.ts`            | `extractJsonFromLLM()` 从 LLM 文本中安全抽取 JSON                                                                                     |

### `src/constants/` — 应用级常量（P1-02 落地）

集中收敛原本散落的字面量，单一来源、避免拼写漂移：

| 文件           | 导出        | 职责                                                                                                                                          |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes.ts`    | `ROUTES`    | 全站路由路径（`home`/`holdings`/`detail(id)`/`stock(code)`/`ranking`/`settings` 等）；导航一律走 `ROUTES`，路径「注册」仍在 `router.tsx` 同步 |
| `endpoints.ts` | `API_BASES` | 外部服务端点（LLM / GitHub Gist / 腾讯 K 线 / 东财基金）；运行时自定义 baseURL 优先级更高                                                     |

### 其他主要目录

- `src/components/` — UI 组件（按业务域分 `holdings/`、`ranking/`、`settings/`、`plans/` 等子目录）
- `src/hooks/` — 自定义 hooks，含**控制器 hook**（如 `useFundDetailController`/`useRankingController`/`useEtfMappingController`：收敛页面全部状态与衍生数据，配合 Context 供子组件消费）
- `src/services/` — 第三方库调用封装、领域服务
- `src/stores/` — Zustand 全局状态（持仓、设置、计划等）
- `src/adapters/` — 数据源适配器（抽象取数，便于替换底层库）
- `src/types/` — 全局 TypeScript 类型定义

### 重构约定

- 巨型页面组件按「**控制器 hook + Context + 纯展示子组件 + 母页退化为 Provider 包裹**」拆分（详见 `PENDING_PLAN.md` 第四节验收说明）。
- 端点 / 路由等字面量优先收敛到 `src/constants/`，不散落硬编码。
- 通用工具放 `src/lib/`，不新建独立 `utils/` 目录。

## License

MIT

## 开发路线

- [PENDING_PLAN.md](./PENDING_PLAN.md) — 总体待办与阶段规划
- [PLAN-decision-optimization.md](./PLAN-decision-optimization.md) — 决策引擎算法优化（T1–T5）设计 + 实施记录
- `archive/` — 已落地 / 过期文档归档目录（含历史 `.planning/` 工作目录），清理时归档而非删除
