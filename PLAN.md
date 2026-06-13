# 基金投资助手 - 完整技术方案

## 一、技术栈决策

| 层级 | 选择 | 理由 |
|------|------|------|
| 框架 | React 18 + TypeScript + Vite | 生态最丰富，shadcn/ui 原生支持，PWA 集成成熟 |
| UI | Tailwind CSS + shadcn/ui | 源码级可控，易定制，体积小 |
| 状态管理 | Zustand | 极轻量（~1KB），API 简洁，支持持久化中间件 |
| 本地存储 | Dexie.js (IndexedDB) | 结构化查询、索引、事务支持，比原生 IndexedDB API 友好 10 倍 |
| 路由 | React Router v6 | SPA 标配，嵌套路由支持好 |
| PWA | vite-plugin-pwa + Workbox | 离线缓存、安装提示、通知推送一条龙 |
| 图表 | Recharts | React 原生，轻量，满足基金走势图表需求 |
| 表格 | TanStack Table (react-table) | 无头表格库，排序/筛选/分页，完全可控 |
| CSV | PapaParse | 持仓导入导出 |
| PDF | jsPDF | 投资报告导出 |

## 二、架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    应用层 (React SPA)                     │
├───────────┬───────────┬───────────┬───────────┬─────────┤
│ 持仓管理   │ 数据看板   │ 投资计划   │ Prompt生成 │ 设置     │
├───────────┴───────────┴───────────┴───────────┴─────────┤
│                    核心服务层                             │
├───────────┬───────────┬───────────┬─────────────────────┤
│ 数据源引擎 │ 存储适配器  │ AI 适配器  │ 通知服务             │
│ (MCP/API) │ (Storage   │ (LLM      │ (Notification       │
│            │  Adapter)  │  Adapter) │  Service)           │
├───────────┴───────────┴───────────┴─────────────────────┤
│                  Zustand Store (状态)                     │
├─────────────────────────────────────────────────────────┤
│         Dexie.js IndexedDB (本地持久化)                    │
│         + Service Worker (PWA 离线)                      │
└─────────────────────────────────────────────────────────┘
```

### 核心设计模式

#### 1. 存储适配器模式 (Storage Adapter)
```
interface StorageAdapter {
  id: string;
  name: string;
  type: 'holdings' | 'plans' | 'settings' | 'all';
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  sync(): Promise<void>;           // 双向同步
  isConfigured(): boolean;
}
```
内置实现：IndexedDBAdapter（默认），可扩展：NotionAdapter、FeishuAdapter、SupabaseAdapter。
用户只需在设置页选择存储后端 + 填写 API Key。

#### 2. AI 平台适配器模式 (AI Adapter)
```
interface AIAdapter {
  provider: 'deepseek' | 'google' | 'openai' | 'custom';
  chat(messages: Message[]): Promise<string>;
  isConfigured(): boolean;
}
```
用户在设置页添加自己的 API Key，前端直接调用各平台 API（完全无后端）。

#### 3. 数据源适配器模式 (Data Source Adapter)
```
interface FundDataSource {
  name: string;
  fetchQuote(codes: string[]): Promise<FundQuote[]>;
  fetchKLine(code: string, period: string): Promise<KLineData[]>;
  fetchFundInfo(code: string): Promise<FundInfo>;
  isAvailable(): boolean;
}
```
支持：Tushare MCP、westock-data、neodata-financial-search，可在设置页切换。

#### 4. 通知适配器模式 (Notification Adapter)
```
interface NotificationAdapter {
  channel: 'browser' | 'feishu' | 'email';
  send(title: string, body: string): Promise<void>;
  isSupported(): boolean;
}
```

## 三、功能模块详细设计

### 模块 1：持仓管理
- **导入**：CSV/Excel 上传（PapaParse 解析），手动录入表单
- **字段**：基金代码、名称、持仓成本、持有份额、购买日期、自定义标签
- **归类**：自动匹配基金类型（股票型/混合型/债券型/指数型/QDII 等）+ 投资领域（科技/消费/医药/新能源...）
- **展示**：TanStack Table，支持排序、筛选、搜索、分页
- **批量操作**：多选后→导出 Prompt / 导出 CSV / 删除

### 模块 2：数据看板
- 持仓总览：总市值、总盈亏、持仓收益率、今日涨跌
- 持仓分布：饼图（按类型/领域/单只基金）
- 净值走势：选定基金的历史净值折线图（Recharts）
- 场外 ETF ↔ 场内 ETF 映射表（用户可自定义映射），用于 Prompt 生成时补充 K 线数据

### 模块 3：投资计划引擎
- **规则定义**：每只基金可设置独立的买入/卖出规则
  ```
  规则模板：
  - 收益率触发：收益率 < -X% → 补仓 Y 份
  - 收益率触发：收益率 > +X% → 止盈 Y 份
  - 涨跌幅触发：单日跌幅 > X% → 买入提醒
  - 定投触发：每 N 天/周/月 → 买入 Y 份
  ```
- **份数系统**：用户定义总资金池和单份金额，所有操作按份计算
- **提醒展示**：Dashboard 上清晰显示哪些基金触发了规则，建议操作
- **计划日志**：记录每次提醒和建议，支持手动标记「已执行」

### 模块 4：Prompt 生成器（核心差异化功能）
- **多选持仓** → 一键生成结构化 Prompt
- **Prompt 模板**（由提示词工程专家设计）：
  1. **持仓诊断模板**：包含所有持仓的代码、成本、收益率、今日涨跌、投资领域
  2. **场内 ETF K 线增强模板**：场外 ETF 自动查找对应场内 ETF，附 K 线关键数据
  3. **调仓建议模板**：包含当前持仓 + 投资计划触发情况 + 市场背景
- **一键复制**：Clipboard API
- **目标平台适配**：可配置目标 AI 平台（DeepSeek / ChatGPT / Claude 等），自动调整 Prompt 格式

### 模块 5：通知系统
- **Web Push**：浏览器推送通知（Service Worker + Push API）
- **触发时机**：投资计划规则触发时 / 用户设定的每日定时 / 自定义时间
- **飞书预留**：通知适配器接口已设计，后续直接实现 FeishuAdapter

### 模块 6：设置页
```
├── 数据存储配置
│   ├── [默认] 浏览器本地存储
│   ├── [可选] Notion (需填写 Integration Token + Database ID)
│   └── [可选] 飞书多维表格 (需填写 App ID + Secret)
├── AI 平台配置
│   ├── DeepSeek API Key
│   ├── Google AI Studio API Key
│   ├── OpenAI API Key
│   └── 自定义 API (Base URL + Key)
├── 数据源配置
│   ├── Tushare Token
│   ├── westock-data 偏好设置
│   └── neodata-financial-search 偏好设置
├── 通知配置
│   ├── 浏览器推送开关
│   └── 推送时机设置
└── 场外↔场内 ETF 映射
    └── 用户可自定义映射表
```

## 四、PWA 配置

```json
// vite-plugin-pwa 配置要点
{
  "registerType": "autoUpdate",
  "workbox": {
    "globPatterns": ["**/*.{js,css,html,woff2}"],
    "runtimeCaching": [
      {
        "urlPattern": "/api/*",
        "handler": "NetworkFirst"    // API 优先走网络，失败用缓存
      }
    ]
  },
  "manifest": {
    "name": "基金投资助手",
    "short_name": "基投助手",
    "theme_color": "#0f172a",
    "display": "standalone",
    "icons": [...]
  }
}
```

PWA 带来的好处：
- 可安装到桌面/手机主屏幕，体验接近原生 App
- 离线可用（持仓数据本地存储）
- 支持推送通知
- 跨平台（iOS Safari / Android Chrome / Desktop）

## 五、项目结构

```
fund-assistant/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── public/
│   ├── manifest.json
│   ├── sw.js              # Service Worker
│   └── icons/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx
│   ├── components/
│   │   ├── ui/             # shadcn/ui 组件
│   │   ├── layout/         # 布局组件
│   │   ├── holdings/       # 持仓相关组件
│   │   ├── dashboard/      # 看板组件
│   │   ├── plans/          # 投资计划组件
│   │   ├── prompts/        # Prompt 生成组件
│   │   └── settings/       # 设置组件
│   ├── stores/             # Zustand stores
│   ├── adapters/           # 适配器实现
│   │   ├── storage/        # IndexedDB, Notion, Feishu
│   │   ├── ai/             # DeepSeek, Google, OpenAI
│   │   ├── datasource/     # Tushare, westock, neodata
│   │   └── notification/   # Browser, Feishu
│   ├── services/           # 业务逻辑服务
│   ├── hooks/              # 自定义 hooks
│   ├── lib/                # 工具函数
│   ├── types/              # TypeScript 类型
│   └── assets/             # 静态资源
└── .workbuddy/
    └── memory/
```

## 六、数据流

```
用户导入持仓
    ↓
CSV 解析 → 校验 → 存储到 IndexedDB
    ↓
用户查看看板
    ↓
从 IndexedDB 读取持仓 → 调用数据源 API 获取实时行情
    ↓
合并数据 → 计算盈亏/收益率 → 渲染图表
    ↓
投资计划引擎检查
    ↓
规则匹配 → 触发通知 → 记录日志
    ↓
用户选中持仓 → 生成 Prompt
    ↓
Prompt 模板填充 + 场内 ETF K 线查询 → 复制到剪贴板
```

## 七、实施计划 (分 6 个阶段)

### Phase 1：项目脚手架 + 核心基础设施 ✅
- Vite + React + TypeScript 初始化
- Tailwind + shadcn/ui 配置
- Zustand Store 骨架 + Dexie.js 数据库 Schema
- 路由结构 + 基础布局（侧边栏导航）
- PWA 基础配置
- 统一 AI API 调用层（DeepSeek/OpenAI/Gemini/自定义）

### Phase 2：持仓管理模块 ✅
- 持仓数据模型 + IndexedDB CRUD
- CSV/Excel 导入解析 + AI 截图识别
- 手动批量录入表单（多代码 + 展开式字段）
- 两种持仓输入方式：成本×份额 / 金额+收益
- 持仓列表展示（TanStack Table）
- 基金自动归类逻辑

### Phase 3：数据看板 + 数据源接入
- 看板概览卡片（总市值、盈亏、收益率）
- 持仓分布图表（饼图/柱状图）
- 净值走势图（Recharts）
- Tushare MCP / westock-data / neodata-financial-search 适配器
- 场外↔场内 ETF 映射系统

### Phase 4：投资计划引擎
- 规则定义模型
- 份数系统
- 规则匹配引擎
- 提醒展示面板
- 操作日志

### Phase 5：Prompt 生成器 + AI 集成
- Prompt 模板设计（调用提示词工程专家）
- 持仓数据 → Prompt 填充
- 场内 ETF K 线数据补充
- 一键复制 + 平台适配
- AI API Key 配置界面

### Phase 6：通知 + 存储扩展 + 设置页
- Web Push 通知
- 存储适配器抽象 + Notion 适配器
- 设置页完整 UI
- 数据同步功能
- 暗色模式
- 部署配置（静态托管零成本方案）

## 八、附加功能推荐

除你列出的 8 项核心功能外，建议：

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 暗色模式 | PWA 标配，提升夜间使用体验 |
| P0 | 数据导入/导出 (CSV) | 迁移和数据备份刚需 |
| P1 | 持仓盈亏仪表盘 | 可视化总览，投资决策的依据 |
| P1 | 基金对比工具 | 并排对比多只基金的关键指标 |
| P1 | 费率影响计算器 | 管理费/托管费复利影响，长期持有必备 |
| P2 | 基金自选列表 | 独立于持仓的关注列表 |
| P2 | 定投模拟器 | 历史回测定投收益率 |
| P2 | 组合风险分析 | 相关性矩阵、行业集中度、最大回撤 |
| P3 | i18n | 中文/英文切换 |
| P3 | 投资日历 | 分红登记日、除权日、财报披露等 |

## 九、已确认决策

| 决策项 | 结论 |
|--------|------|
| 部署方式 | 纯静态托管（GitHub Pages / CloudStudio / EdgeOne Pages，零成本） |
| 数据源 | Tushare 为主（用户已有 Token），westock-data / neodata 为备选 |
| 持仓规模 | 20-50 只，需要筛选/搜索/分页 |
| 通知 | 浏览器 Push 首发，飞书预留接口 |
| 存储 | 本地 IndexedDB 为主，可选 Notion/飞书同步 |

## 十、进度追踪

| Phase | 状态 | 内容 |
|-------|------|------|
| Phase 1 | ✅ 完成 | 脚手架 + AI 服务层 + PWA |
| Phase 2 | ✅ 完成 | 持仓管理（CSV/截图/AI 批量录入） |
| Phase 3 | 🔜 下一步 | 数据看板 + 数据源接入 |
| Phase 4 | ⏳ 待开始 | 投资计划引擎 |
| Phase 5 | ⏳ 待开始 | Prompt 生成器 + AI 集成 |
| Phase 6 | ⏳ 待开始 | 通知 + 存储扩展 + 设置页 |
