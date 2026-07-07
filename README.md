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
- **K 线走势** — 纯 SVG 蜡烛图，支持场内 ETF 真实 K 线（OHLC + 成交量）与 NAV 折线切换
- **技术指标叠加** — MA5/MA10/MA20/MA60 均线 + BOLL(20,2) 布林带，可切换显示
- **K 线形态检测** — 三层算法引擎自动识别 14 种单 K + 6 种多 K 组合形态，AI 深度分析
- **综合评分** — 多指标融合信号评分（MA/MACD/RSI/Bollinger/形态/量能），权重公开可调
- **重仓股穿透** — 前十大重仓股及占比
- **Prompt 生成** — 三种模板：持仓诊断 / 调仓建议 / K 线增强，一键复制
- **缓存智能过期** — K 线/行情/基金信息按 A 股交易时段自动刷新，盘尾段手动刷新
- **更新时间显示** — 各卡片标题旁显示「更新于 HH:MM」

### ⚙️ 投资计划
- **规则引擎** — 全局规则，所有基金共用：收益率触发、净值价差触发、单日涨跌幅触发、定期定投、K 线形态 AI 诊断
- **手动扫描** — 点击"检查"遍历所有持仓，匹配规则生成提醒
- **提醒面板** — 待处理提醒列表，支持「快速调仓」「已执行」「已读」
- **操作日志** — 历史提醒记录
- **浏览器通知** — 扫描触发时推送

### 🎯 Prompt 生成器
- 多选持仓 → 选择模板 → 一键生成结构化的 AI 投资分析 Prompt
- 支持诊断/调仓/K 线增强三种专业模板
- 与投资计划联动（调仓模板自动包含触发规则信息）

### 🔌 多数据源（自动降级）
| 数据源 | 配置要求 | 支持功能 |
|--------|---------|---------|
| **stock-api** | 内置（npm 依赖），零配置 | 股票/ETF **实时行情**、**场内 ETF K 线**（OHLC+成交量）、基金实时估算净值、股票搜索、自动 **腾讯 → 东方财富 → 新浪 三级兜底（含熔断自动恢复）** |
| **东方财富 fundgz** | 内置，零配置 | 场外基金 **实时估算净值**（盘中 gsz + 盘后 dwjz） |
| **东方财富 pingzhongdata** | 内置，零配置 | 基金 **历史净值走势**、**重仓股穿透**、资产配置、基金经理等完整数据 |
| **Tushare Pro** | 注册 tushare.pro 获取 Token | 基金基本信息、实时净值、历史净值 |

> **零后端、零配置**：所有股票/ETF/基金数据均在前端浏览器中直接获取（腾讯接口 + fundgz JSONP + pingzhongdata），无需运行任何额外服务。

### 🛰️ K 线 / 行情数据源详解（腾讯 → 东方财富 → 新浪 + 熔断自动恢复）

所有股票 / ETF 行情与 K 线均通过**浏览器 `<script>` 标签 JSONP** 方式直接请求，不依赖任何后端，也不存在 CORS 跨域问题（JSONP 不受同源策略限制）。

**为什么用 JSONP 而不是 fetch？**
- 腾讯、东方财富、新浪的行情接口本身**不返回 `Access-Control-Allow-Origin` 响应头**，浏览器内用 `fetch` / `XMLHttpRequest` 直连会被同源策略拦截（`net::ERR_FAILED` / CORS 报错）。
- 因此一律改用 JSONP（动态插入 `<script>`），绕开 CORS。

**三级兜底顺序（任一源成功即返回）：**

| 优先级 | 数据源 | 接口 | 说明 |
|--------|--------|------|------|
| 1（主源） | **腾讯财经** | `web.ifzq.gtimg.cn/appstock/app/fqkline/get` | 数据最全、覆盖沪深，JSONP 回调形式 |
| 2（兜底） | **东方财富** | `push2his.eastmoney.com/api/qt/stock/kline/get` | 腾讯无数据时补位 |
| 3（兜底兜底） | **新浪财经** | `money.finance.sina.com.cn/.../jsonp_v2.php/CN_MarketData.getKLineData` | 前两者均被拦截时兜底 |

> ⚠️ **关于新浪接口的一个坑**：早期 `stock-api` 库默认走新浪 `json_v2.php`，那是**裸 JSON**（`fetch` 直连），必然被 CORS 拦截、看起来"完全不可用"。但其实新浪另有 `jsonp_v2.php` 接口（返回形如 `var cb=([...]);`），改用 `<script>` 加载**完全可用**（已实测 HTTP 200 正常返回 OHLC）。本项目已接入该接口作为第三档兜底——并非"删掉就废了"，而是之前用错了入口。

**被拦截 / 限流怎么办？（四层防护 + 熔断）**

浏览器发出的请求来自**你本机 IP**。腾讯 / 东方财富对高频或异常流量会做**临时限流 / 拦截**（表现：`ERR_EMPTY_RESPONSE`、超时），这是**临时性的**，通常冷却**数小时到一天**会自动恢复，并非接口挂掉——服务器侧实测腾讯 / 新浪均正常，被拦的只是你本机 IP。

为此实现了多层防护：
1. **内存缓存** — 日 K 日内不变，成功结果缓存 10 分钟、空结果缓存 2 分钟，避免重复请求。
2. **并发去重** — 同一「代码 + 周期」在途只发一次请求。
3. **并发限流** — 信号量控制最多 3 个在途 K 线请求，防突发打爆。
4. **瞬时失败重试** — 超时 / 拦截重试 1 次（间隔 600ms）后转下一源。
5. **源熔断（自动恢复）** — 某源连续失败即进入 **2 分钟冷却期**，期间直接跳过该源、走下一档；冷却结束自动重试。所以"明天恢复了"会**自动生效**，无需任何改动。

**如果看到 K 线空白 / 报错：**
- 多刷新几次：被限流的源会在 2 分钟后熔断跳过，新浪兜底会顶上。
- 若长时间全空白：大概率是本机 IP 被三家同时限流，等冷却（或切换网络，如手机热点）即可恢复；届时熔断冷却结束会自动重新启用各源。

### 🤖 AI 功能
- **6 种 AI 平台** — DeepSeek / Google AI Studio / OpenAI / Groq / OpenRouter / 自定义 API
- **截图识别** — AI Vision API 从持仓截图提取基金信息
- **ETF 映射查询** — 自动查询场外→场内对应关系
- **连接测试** — 验证 API Key 有效性
- **不配置也**不影响核心持仓功能

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
- **通知** — 浏览器推送通知（Service Worker）

## 技术栈

| 类别 | 选择 | 版本 |
|------|------|------|
| 框架 | React + TypeScript + Vite | v19 + v6 + v8 |
| UI | Tailwind CSS + shadcn/ui | v4 + 17 个 Radix 组件 |
| 状态管理 | Zustand | v5 |
| 本地存储 | Dexie.js (IndexedDB) | v4 |
| 路由 | React Router | v7 |
| PWA | vite-plugin-pwa + Workbox | v1 |
| 图表 | Recharts + 纯 SVG | v3 |
| 表格 | TanStack Table | v8 |
| CSV/Excel | PapaParse / xlsx | — |
| **数据源** | **stock-api**（股票/ETF 实时行情，零后端） | v2.7 |
| 代码质量 | ESLint + TypeScript | v10 + v6 |
| CI/CD | GitHub Actions (quality + deploy) | — |

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

### 配置数据源（可选）

应用默认使用 **stock-api** + **东方财富 fundgz/pingzhongdata** 获取全部数据，零配置即用。

如需切换到 Tushare：

| 数据源 | 设置步骤 |
|--------|---------|
| **stock-api + 东方财富** | 内置，零配置。股票/ETF 使用腾讯接口（东方财富、新浪兜底），基金净值使用 fundgz JSONP，历史数据使用 pingzhongdata |
| **Tushare** | 设置 → 数据源 → 选择 Tushare → 填写 Token（[注册](https://tushare.pro)） |

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
├── .github/workflows/
│   ├── deploy.yml        # GitHub Pages 部署（quality → build → deploy）
│   └── quality.yml       # PR/push 时运行 ESLint + tsc + build
├── src/
│   ├── main.tsx           # 入口
│   ├── App.tsx            # 根组件（主题切换 + 通知权限 + Error Boundary）
│   ├── router.tsx         # 路由定义（8 条路由）
│   ├── index.css          # Tailwind + CSS 变量
│   ├── components/
│   │   ├── ui/            # 17 个 shadcn/ui 组件
│   │   ├── layout/        # AppLayout（侧边栏 + 顶部栏 + Outlet）+ InstallPrompt
│   │   ├── dashboard/     # DashboardPage, CandlestickChart, FundDetailGateway
│   │   ├── holdings/      # HoldingsPage/Table, Add/Edit/Import/FundDetail/QuickAdjust Dialog
│   │   ├── plans/         # PlansPage（规则配置 + 提醒面板 + 操作日志）
│   │   ├── prompts/       # PromptsPage（三种模板生成器）
│   │   └── settings/      # SettingsPage（7 个 Tab）+ NotificationsPage
│   ├── stores/            # Zustand stores: holdings, plans, settings + Dexie db
│   ├── services/          # ai.ts, backup.ts, klineCache.ts, klinePatterns.ts, klineAnalysis.ts
│   │                      # technicalIndicators.ts, signalEngine.ts, notification.ts, prompt.ts
│   ├── adapters/datasource/ # base.ts + stock-api.ts + tushare.ts + eastmoney.ts + jsonp-utils.ts + service.ts
│   ├── lib/               # classification.ts, utils.ts
│   └── types/             # index.ts（全部 TS 类型定义）
```

## 常见问题

| 问题 | 解决 |
|------|------|
| `EBADENGINE` / TLS 错误 | 命令前加 `NODE_OPTIONS=""` |
| `ERESOLVE` 依赖冲突 | 使用 `npm install --force` |
| 端口被占用 | Vite 自动切换到下一个可用端口 |
| 数据存在哪里？ | 浏览器 IndexedDB，清除浏览器数据会丢失 |
| 需要数据库或后端？ | 不需要，纯前端应用。股票/ETF 使用 stock-api 直接在浏览器请求腾讯接口，基金数据使用 fundgz JSONP + pingzhongdata |
| ETF K 线显示空白？ | 已接入 **腾讯 → 东方财富 → 新浪** 三级兜底 + 源熔断：前源被限流 / 拦截时新浪会顶上；空白多为本机 IP 被限流（临时，数小时~1 天恢复），刷新或切换网络即可 |

## 部署

`npm run build` 后的 `dist/` 目录可部署到任何静态托管服务：

- GitHub Pages（[playbook](./.github/workflows/deploy.yml) 已配好，push 到 main 自动部署）
- CloudStudio Pages
- EdgeOne Pages
- Vercel / Netlify

## License

MIT

## 开发路线

参见 [PLAN.md](./PLAN.md)
