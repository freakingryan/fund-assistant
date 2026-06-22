# 基金投资助手

一个跨平台（Web + PWA）的基金持仓管理与投资决策辅助工具，纯静态部署，零后端成本。

## 功能

- **持仓管理** — 支持 CSV/Excel 文件导入、AI 截图识别、手动批量录入
  - 两种持仓输入方式：成本净值 × 持有份额 / 持有金额 + 持有收益
  - 仅需基金代码（必填），其余字段可选
  - AI 批量查询自动补全基金名称、类型、投资领域
  - 自动归类基金类型（股票型/混合型/债券型等）和投资领域（科技/消费/医药等）
- **数据看板** — 持仓总览（市值/盈亏/收益率/今日涨跌）、类型/领域分布图表、净值走势、ETF 真实 K 线蜡烛图
- **多数据源** — 支持 Tushare（MCP/HTTP）、AKShare（本地 AKTools，最推荐）、东方财富（JSONP 免费接口），未配置时自动模拟数据
- **ETF 映射** — 场外↔场内 ETF 映射表，支持 AI 自动查询和 AKShare 名称匹配，添加基金时自动保存映射
- **场内 ETF 真实 K 线** — 通过 AKShare 获取场内 ETF 日频真实 OHLC + 成交量数据，绘制标准 SVG 蜡烛图（需配置 AKTools）
- **K 线数据缓存** — IndexedDB 缓存 K 线数据，按周期 15 分钟～4 小时 TTL，切换基金瞬间展示
- **基金持仓穿透** 🆕 — 查看基金前十大重仓股与行业分布（需配置 AKTools）
- **基金排行筛选** 🆕 — 按近 1 月/3 月/1 年收益筛选推荐基金（需配置 AKTools）
- **多 AI 平台** — 支持 DeepSeek / OpenAI / Google AI Studio / 自定义 API
- **多存储后端** — 本地 IndexedDB（默认），可选 Notion 同步（开发中）
- **PWA** — 可安装到桌面/手机，离线可用

## 技术栈

| 类别 | 选择 |
|------|------|
| 框架 | React 18 + TypeScript + Vite 8 |
| UI | Tailwind CSS v4 + shadcn/ui |
| 状态管理 | Zustand |
| 本地存储 | Dexie.js (IndexedDB) |
| 路由 | React Router v6 |
| PWA | vite-plugin-pwa + Workbox |
| 图表 | Recharts |
| 表格 | TanStack Table |
| 数据 | PapaParse / xlsx |

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

# 3. 开发模式（默认 http://localhost:5173）
npm run dev
```

Vite 支持 HMR，修改代码后浏览器自动热更新。

### 构建 & 预览

```bash
# 构建产物输出到 dist/
npm run build

# 本地预览构建结果
npm run preview
```

### 配置数据源（可选）

数据源可在「设置」页面中配置，也可直接在浏览器控制台配置：

**Tushare**（推荐，需注册 [tushare.pro](https://tushare.pro) 获取 Token）：
1. 打开应用 → 设置 → 数据源
2. 选择「Tushare」
3. 填写你的 Tushare Token
4. 未配置时自动使用模拟数据，不影响核心功能试用

**AKShare**（通过 [AKTools](https://aktools.akfamily.xyz/) 本地 HTTP API）：
1. 安装 AKTools：`pip install aktools`
2. 启动服务：`python -m aktools`（默认监听 `http://127.0.0.1:8080`）
3. 打开应用 → 设置 → 数据源
4. 选择「AKShare（本地 AKTools）」
5. 确认 AKTools 地址（默认 `http://127.0.0.1:8080`）

> AKTools 基于 FastAPI 构建，启动后自动允许跨域访问。数据来源与 AKShare 一致，覆盖公募基金基本信息、实时净值、历史净值、场内 ETF 日频行情（含 OHLC + 成交量）等。支持自定义部署到远程服务器作为私有数据源网关。
>
> 💡 **AKShare 是最推荐的数据源**：无需注册、无需 Token、数据最完整（含 ETF 真实 K 线），只需本地 `pip install aktools && python -m aktools`。

### 配置 AI（可选）

AI 功能用于持仓截图识别和基金信息自动补全，在「设置 → AI 平台」中配置：

| 平台 | API Key 获取地址 |
|------|-----------------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) |
| Google AI Studio | [aistudio.google.com](https://aistudio.google.com) |
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| 自定义 | 自行填写 Base URL + API Key |

> 💡 AI 功能是完全可选的。不配置也不影响持仓管理和看板等核心功能。

### 常见问题

| 问题 | 解决 |
|------|------|
| `EBADENGINE` / TLS 错误 | 命令前加 `NODE_OPTIONS=""`，如 `NODE_OPTIONS="" npm run dev` |
| `ERESOLVE unable to resolve dependency tree` | 使用 `npm install --force` |
| 端口被占用 | Vite 会自动切换到下一个可用端口，注意终端输出提示 |
| 开发服务器退出后无法访问 | Vite 进程依赖当前会话，重新运行 `npm run dev` 即可 |
| 数据存在哪里？ | 所有数据存储在浏览器 IndexedDB 中，清除浏览器数据会丢失。可在「设置→存储」中选择外部存储（开发中） |
| 需要数据库或后端吗？ | **不需要**。纯前端应用，零后端，IndexedDB 本地持久化 |
| AKShare 查询失败？ | 确认已安装 `pip install aktools` 且 `python -m aktools` 正在运行。默认连接 `http://127.0.0.1:8080`，可在设置页修改 |
| 东方财富 API 报跨域错误？ | 东财接口不支持 `fetch()` 直接调用（无 CORS 头）。应用会自动使用 JSONP 方式绕过此限制，无需额外配置 |

## 纯静态部署

构建产物在 `dist/` 目录，可直接部署到任何静态托管服务：

- GitHub Pages
- CloudStudio Pages
- EdgeOne Pages
- Vercel

完全不需要服务器或后端。

## 项目结构

```
src/
├── components/
│   ├── ui/          # shadcn/ui 基础组件
│   ├── layout/      # 应用布局
│   ├── dashboard/   # 数据看板
│   ├── holdings/    # 持仓管理
│   ├── plans/       # 投资计划
│   ├── prompts/     # Prompt 生成
│   └── settings/    # 设置页
├── stores/          # Zustand 状态管理
├── adapters/        # 适配器（数据源、存储、AI、通知）
│   └── datasource/  # 数据源实现：Tushare、AKShare、东方财富、模拟
├── types/           # TypeScript 类型定义
└── lib/             # 工具函数
```

## 开发计划

参见 [PLAN.md](./PLAN.md)

## License

MIT
