# 基金投资助手 — 完整技术方案 & 进度追踪

## 一、技术栈决策

| 层级 | 选择 | 说明 |
|------|------|------|
| 框架 | React 19 + TypeScript 6 + Vite 8 | 最新稳定版，shadcn/ui 原生支持，PWA 集成成熟 |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) | 源码级可控，零 runtime CSS |
| 状态管理 | Zustand 5 | 极轻量（~1KB），API 简洁 |
| 本地存储 | Dexie.js 4 (IndexedDB) | 结构化查询、索引、事务支持 |
| 路由 | React Router 7 | SPA 标配，嵌套路由 |
| PWA | vite-plugin-pwa + Workbox | 离线缓存 + 安装提示 + 推送通知 |
| 图表 | Recharts 3 + 纯 SVG | 饼图/柱状图 + 自研蜡烛图 |
| 表格 | TanStack Table 8 | 无头表格库，排序/筛选/搜索/列显隐 |
| 代码质量 | ESLint 10 + TypeScript 6 | unused-imports 插件 + GitHooks CI |

## 二、架构设计

```
┌──────────────────────────────────────────────────────────┐
│                   应用层 (React SPA)                       │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ 持仓管理  │ 数据看板  │ 基金详情  │ 投资计划  │ Prompt 生成器│
│ (6 组件)  │ (3 组件)  │ (1 页面)  │ (1 页面)  │ (1 页面)     │
├──────────┴──────────┴──────────┴──────────┴──────────────┤
│                 核心服务层                                 │
├────────────────┬────────────────┬───────────────────────┤
│ 数据源引擎      │ AI 平台适配器    │ 多级缓存服务           │
│ (AKShare /     │ (DeepSeek /     │ (K线/行情/排行/基金信息/  │
│  Tushare /     │  Google /       │  ETF映射，交易时间      │
│  东财 / 模拟)   │  OpenAI / ...)  │  智能过期)             │
├────────────────┴────────────────┴───────────────────────┤
│                  Zustand Stores (状态管理层)                │
├─────────────────────────────────────────────────────────┤
│              Dexie.js IndexedDB (持久化层)                 │
│              + Service Worker (PWA 离线)                  │
└─────────────────────────────────────────────────────────┘
```

### 核心设计模式

#### 1. 数据源适配器模式 (Data Source Adapter)
```typescript
interface FundDataSource {
  name: string
  fetchFundInfo(code: string): Promise<{ name: string; type: string }>
  fetchQuotes(codes: string[]): Promise<FundQuote[]>
  fetchKLine(code: string, period?: string): Promise<KLineData[]>
  fetchEtfKLine?(code: string, period?: string): Promise<KLineData[]>  // 可选
}
```
实现类：`AKShareAdapter`、`TushareAdapter`、`EastMoneyAdapter`。  
路由服务 `DataSourceService` 按优先级（AKShare → Tushare → 东方财富）依次尝试，自动降级。

#### 2. AI 平台适配器
```typescript
interface AIConfig { provider: AIProvider; apiKey: string; baseURL?: string; model?: string }
```
6 种提供方：DeepSeek / Google / OpenAI / Groq / OpenRouter / 自定义。  
调用函数 `callAI()` 统一处理请求格式和错误。

#### 3. 多级缓存策略
```
缓存分类        前缀   TTL/策略
──────────    ─────   ─────────────────
K 线数据       k_     按周期 15min~4h（静态 TTL）
基金持仓       pf_    2h
基金排行       rk_    24h
实时净值       q_     交易时段智能过期（10:30/14:00 刷新）
基金信息       fi_    24h
ETF 映射       em_    7 天
```

交易时段智能 TTL：
| 时间段 | 策略 |
|--------|------|
| 9:30~10:30 | 10:30 过期 |
| 10:30~11:30 | 不自动过期（用户手动刷新） |
| 11:30~13:00 | 14:00 过期 |
| 13:00~14:00 | 14:00 过期 |
| 14:00~15:00 | 不自动过期（用户手动刷新） |
| 非交易时间 | 24h 长缓存 |

## 三、功能模块详解

### 模块 1：持仓管理 (`src/components/holdings/`)

| 组件 | 功能 |
|------|------|
| **HoldingsPage** | 页面容器 + 空状态引导 |
| **HoldingsTable** | TanStack Table 表格：多选/排序/搜索/筛选/列显隐/批量删除/行点击跳转/操作按钮 |
| **AddFundDialog** | 批量添加：多行输入、两种计算方式、AKTools 快速查询、基金排行推荐 |
| **EditFundDialog** | 编辑单个基金全部字段 + AKTools 自动补全（名称/类型/领域 + ETF 映射） |
| **ImportDialog** | CSV/Excel 文件导入 + AI 截图识别导入 |
| **QuickAdjustDialog** | 补仓（按金额/份额，自动获取净值） / 减仓（按份额/金额/比例） |
| **FundRankDialog** | 基金排行推荐弹窗（按类型/期间排序，多选添加） |
| **FundDetailPage** | K 线图 + 重仓股穿透 + Prompt 生成 + 编辑/调仓按钮 |

### 模块 2：数据看板 (`src/components/dashboard/`)

- **摘要卡片**：总市值、总盈亏、收益率、今日涨跌、基金数
- **分布图表**：类型饼图 + 领域柱状图（Recharts）
- **TOP 10 持仓**：排序列表
- **投资计划提醒**：面板集成（待处理提醒列表）
- **手动刷新**：行情数据 + 缓存更新时间显示

### 模块 3：基金详情页 (`FundDetailPage.tsx`)

- **K 线走势**（左侧，lg:col-span-2）：
  - 纯 SVG CandlestickChart（ETF 真实 OHLC + 成交量 / NAV 折线 + ETF/NAV 切换开关）
  - 4 个周期：1月/3月/6月/1年
  - IndexedDB 缓存（v2 版本号强制刷新）+ 手动刷新 + 更新时间显示
  - 鼠标悬停底部信息栏（零遮挡）+ 触屏点击锁定选中
  - **MA5/MA10/MA20/MA60 均线**（可切换，SVG 折线叠加）
  - **BOLL(20,2) 布林带**（可切换，上/中/下轨 + 填充区域）
  - 技术指标：图例颜色图标（SVG 外部）+ 可折叠详细说明面板（含数据起止日期）
  - 数据方向：左旧右新（data[0]=最早，data[n-1]=最新）
- **K 线形态分析**（左侧，K 线图下）：
  - 三层检测引擎：L1 特征提取 → L2 单 K（14 种）→ L3 多 K 组合（6 种）
  - 形态列表：按时间倒序（最新在上）、悬停 K 线图联动高亮
  - AI 深度分析按钮（调用 AI 生成趋势/支撑/阻力/建议）
  - 生成 Prompt 按钮（联动 K 线增强模板）
  - 可折叠术语说明面板（单 K / 2K 组合 / 3K 组合 / 基础术语）
- **综合评分**（左侧，形态分析下）：
  - 独立评分卡片：综合得分 -100~+100 + 方向标签 + 进度条
  - 关键指标常驻显示：RSI 值、MACD 金叉/死叉、MA 排列、BOLL 信号、量能状态
  - 可展开评分详情：6 路信号各自得分 + 权重（公开可调）+ 信号原文
  - 权重配置：MA(15%) / MACD(15%) / RSI(10%) / BOLL(10%) / 形态(25%) / 量能(15%)
  - 预留 AI 自动优化接口
- **持仓信息**（标题下方，全宽卡片）：
  - 持有份额/成本净值/最新净值(含日涨跌)/投入本金/市值/盈亏/收益率/购买日期
  - 调仓/编辑按钮集成在卡片标题栏
- **重仓股穿透**（右侧栏，Prompt 模板上方）：
  - AKShare fund_portfolio_hold_em，缓存 2h，手动刷新
- **Prompt 模板**（右侧栏）：
  - 诊断/调仓/K 线增强三种模板，附使用说明
  - 传入行情 + ETF 映射 + 重仓股 + 告警 + K 线形态数据
  - 一键复制到剪贴板

### 模块 4：投资计划 (`src/components/plans/PlansPage.tsx`)

- **规则配置**：5 种触发条件、4 种比较方向、买入/卖出操作、份数系统
- **扫描引擎**：遍历所有持仓 × 所有规则 → 去重 → 批量生成 PlanAlert → 浏览器通知
- **提醒面板**：待处理列表，每条含「快速调仓」「已执行」「已读」操作
- **操作日志**：历史记录查看

### 模块 5：Prompt 生成器 (`src/components/prompts/PromptsPage.tsx`)

- 多选持仓 → 选择模板 → 生成结构化的 AI 分析 Prompt
- 三种专业模板（由提示词工程专家设计）
- 联动投资计划：调仓模板自动包含触发规则

### 模块 6：设置页 (`src/components/settings/SettingsPage.tsx`)

| Tab | 内容 |
|-----|------|
| 数据源 | 默认源选择、Tushare Token、AKTools URL |
| AI 平台 | 6 种提供方 + API Key + 连接测试 + 默认平台选择 |
| 存储 | IndexedDB（当前），Notion（灰显「即将推出」） |
| 通知 | 浏览器推送开关、飞书通知预留 |
| ETF 映射 | 添加/删除 OTC↔Exchange 映射、AI 自动查询 |
| 外观 | 浅色/深色/跟随系统 |
| 备份 | 本地 JSON 导出/导入 + GitHub Gist 云端同步 |

## 四、数据流

```
添加/导入持仓
    ↓
文件解析(AI截图识别/CSV) → 校验 → IndexedDB 持久化
    ↓
查看看板 → IndexedDB 读取持仓 → 数据源 API(fetchQuotes)
    ↓
行情缓存(智能过期) → 合并数据 → 计算盈亏/收益率 → 渲染图表
    ↓
投资计划手动扫描 → 遍历持仓×规则 → 生成提醒(去重)
    ↓
用户看到提醒 → 快速调仓(QuickAdjustDialog) → 更新持仓
    ↓
Prompt 生成 → 选择模板 → 填充持仓+行情+提醒+K线 → 复制到剪贴板
```

## 五、路由 & 导航

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | AppLayout | 根布局（侧边栏 + 顶部栏 + Outlet） |
| `/` (index) | DashboardPage | 数据看板首页 |
| `/holdings` | HoldingsPage | 持仓管理 |
| `/detail/:id` | FundDetailPage | 基金详情 |
| `/detail` | FundDetailGateway | 自动跳转第一个持仓 |
| `/plans` | PlansPage | 投资计划 |
| `/prompts` | PromptsPage | Prompt 生成器 |
| `/notifications` | NotificationsPage | 通知概览 |
| `/settings` | SettingsPage | 设置 |

## 六、CI/CD 配置

### `deploy.yml` — GitHub Pages 部署
```
push to main → quality(eslint+tsc) → build(vite build) → deploy to Pages
```

### `quality.yml` — 代码质量检查
```
PR to main / push to main → eslint . + tsc --noEmit + vite build
```

## 七、进度追踪

| Phase | 状态 | 内容 |
|-------|------|------|
| Phase 1 | ✅ 完成 | 项目脚手架 + Tailwind/shadcn/ui + Zustand + Dexie 数据库 + 路由布局 + PWA + AI 调用层 |
| Phase 2 | ✅ 完成 | 持仓数据模型 + CRUD + CSV/Excel/AI 截图导入 + 手动录入（两种计算方式）+ TanStack Table + 自动分类 |
| Phase 3 | ✅ 完成 | 数据看板（摘要卡片 + 饼图 + 柱状图 + TOP 10）+ 多数据源适配器（Tushare/AKShare/东方财富/模拟）+ 路由降级 |
| Phase 4 | ✅ 完成 | 投资计划引擎：全局规则 CRUD + 扫描引擎（5 种触发条件）+ 提醒面板 + 操作日志 + 浏览器通知 |
| Phase 5 | ✅ 完成 | Prompt 生成器（诊断/调仓/K 线增强三种模板）+ 一键复制 + 与投资计划联动 |
| Phase 6.1 | ✅ 完成 | 场内 ETF 真实 K 线：AKShare fund_etf_hist_em + 纯 SVG 蜡烛图 + ETF/NAV 切换 |
| Phase 6.2 | ✅ 完成 | 基金持仓穿透：AKShare fund_portfolio_hold_em 前十重仓股 |
| Phase 6.3 | ✅ 完成 | 基金排行筛选：AKShare fund_open_fund_rank_em + 推荐弹窗 + 一键添加 |
| Phase 6.4 | ✅ 完成 | UI 重构：基金详情页（K 线 + 重仓股 + Prompt 聚合）+ 编辑/调仓按钮 + 快捷调仓对话框 |
| Phase 7 | ✅ 完成 | 数据缓存系统：K 线/行情/排行/基金信息/ETF 映射 + A 股交易时段智能过期 + 缓存更新时间显示 |
| Phase 8 | ✅ 完成 | 刷新按钮：行情/K 线/重仓股/排行各卡片独立手动刷新 |
| Phase 9 | ✅ 完成 | AKTools 替代 AI 查询：基金信息自动补全 + ETF 映射自动查询 + 并行批量查询 |
| Phase 10 | ✅ 完成 | 代码质量：ESLint unused-imports 插件 + 修复 44 个 error + quality.yml CI workflow |
| Phase 11 | ✅ 完成 | 编辑/调仓功能：EditFundDialog（全部字段编辑 + AKTools 补全）+ QuickAdjustDialog（补仓/减仓多模式） |
| Phase 12 | ✅ 完成 | 投资计划快速调仓联动：提醒面板「快速补仓/减仓」按钮 |
| Phase 13 | ✅ 完成 | K 线形态分析引擎：三层分层检测 L1 特征/L2 单K(14种)/L3 多K组合(6种) + CandlestickChart 悬停标签 + AI 深度分析 + 术语说明 |
| Phase 14 | ✅ 完成 | 技术指标叠加：MA5/10/20/60 均线 + BOLL(20,2) 布林带 + SVG 内联渲染 + 图例外置防遮挡 + 可折叠详细说明 |
| Phase 15 | ✅ 完成 | MACD(EMA12-26+信号线)、RSI(14)、成交量均线(VOL-MA5/10/20) + 多指标融合信号评分系统(signalEngine.ts) |
| Phase 16 | ✅ 完成 | UI 一致性：深色/浅色模式适配、触屏支持(Tooltip/选中高亮)、固定高度容器防布局抖动、数据方向左旧右新 |
| Phase 17 | 🔜 待开始 | 通知系统增强：Web Push 定时扫描 + 飞书通知 |
| Phase 18 | 🔜 待开始 | 存储扩展：Notion 适配器实现 |
| Phase 19 | 🔜 待开始 | 数据同步：多设备数据同步方案 |
| Phase 20 | 🔜 待开始 | 组合风险分析：相关性矩阵、行业集中度、最大回撤 |

## 八、已确认决策

| 决策项 | 结论 |
|--------|------|
| 部署方式 | 纯静态托管（GitHub Pages / CloudStudio / EdgeOne Pages，零成本） |
| 数据源 | AKTools 最推荐（免费、功能最全），Tushare 次选，东财 JSONP 自动兜底 |
| AI 平台 | DeepSeek 默认，6 种可选 |
| 存储 | 本地 IndexedDB 为主，可选 GitHub Gist 同步，Notion 预留 |
| 通知 | 浏览器 Push 首发，飞书预留 |
| 投资计划 | 全局共用规则，不设资金池，无限份数 |
| 基础路径 | dev=`/`，production=`/fund-assistant/` |
