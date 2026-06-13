# 基金投资助手

一个跨平台（Web + PWA）的基金持仓管理与投资决策辅助工具，纯静态部署，零后端成本。

## 功能

- **持仓管理** — CSV/Excel 导入或手动录入基金持仓，自动归类投资领域
- **数据看板** — 持仓总览、盈亏分析、分布图表、净值走势
- **投资计划** — 自定义规则引擎（收益率触发、涨跌幅触发、定投），按份数执行买入/卖出提醒
- **Prompt 生成** — 选中持仓一键生成结构化 AI Prompt，支持场外 ETF 结合场内 K 线数据
- **通知系统** — 浏览器推送通知，投资计划触发时提醒
- **多数据源** — 支持 Tushare / 西股数据 / NeoData 切换
- **多 AI 平台** — 支持 DeepSeek / OpenAI / Google AI Studio / 自定义 API
- **多存储后端** — 本地 IndexedDB（默认），可选 Notion 同步
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

```bash
# 安装依赖
npm install --force

# 开发模式
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```

> **注意**：如果遇到 `EBADENGINE` 或 TLS 相关错误，请在命令前添加 `NODE_OPTIONS=""`。

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
├── adapters/        # 适配器（存储/AI/数据源/通知）
├── types/           # TypeScript 类型定义
└── lib/             # 工具函数
```

## 开发计划

参见 [PLAN.md](./PLAN.md)

## License

MIT
