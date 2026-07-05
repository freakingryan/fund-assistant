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
| **stock-api** | 内置（npm 依赖），零配置 | 股票/ETF **实时行情**、**场内 ETF K 线**（OHLC+成交量）、基金实时估算净值、股票搜索、自动腾讯/新浪/东方财富三级兜底 |
| **东方财富 fundgz** | 内置，零配置 | 场外基金 **实时估算净值**（盘中 gsz + 盘后 dwjz） |
| **东方财富 pingzhongdata** | 内置，零配置 | 基金 **历史净值走势**、**重仓股穿透**、资产配置、基金经理等完整数据 |
| **Tushare Pro** | 注册 tushare.pro 获取 Token | 基金基本信息、实时净值、历史净值 |

> **零后端、零配置**：所有股票/ETF/基金数据均在前端浏览器中直接获取（腾讯接口 + fundgz JSONP + pingzhongdata），无需运行任何额外服务。

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
- **云端同步** — GitHub Gist（推拉双向同步）

### 🎨 用户体验
- **亮/暗/跟随系统** 三种主题模式（深色/浅色全适配）
- **PWA** — 可安装到桌面/手机主屏幕，离线可用
- **响应式布局** — 桌面侧边栏 + 移动端抽屉导航，支持手机/平板/折叠屏
- **触屏优化** — K 线图完全触屏支持（Tap 选中/高亮/关闭），底部信息栏零遮挡
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
| **stock-api + 东方财富** | 内置，零配置。股票/ETF 使用腾讯接口，基金净值使用 fundgz JSONP，历史数据使用 pingzhongdata |
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
| ETF K 线显示空白？ | 新版已集成 stock-api，直接通过腾讯接口获取完整 OHLC + 成交量数据 |

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
