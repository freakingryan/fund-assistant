# fund-assistant 数据源全景图

> 生成日期：2026-07-05 | 架构：适配器模式，按优先级自动降级

---

## 一、核心数据源（适配器层）

数据流：`UI 组件` → `dataSourceService.fetchXxx()` → `适配器列表（按优先级逐个尝试）` → `返回第一个有效结果`

### 1️⃣ stock-api（最高优先级 ✅ 活跃）

| 属性 | 值 |
|------|-----|
| 类型 | **npm 包** `stock-api@^2.7.3` |
| 调用方式 | 前端 `import('stock-api')` 动态导入 ESM 模块 |
| 底层接口 | 自动探测：**腾讯 → 新浪 → 东方财富**，底层用 fetch / JSONP |
| 需要配置 | ❌ 无需任何配置 |
| 文档 | https://github.com/zhangxiangliang/stock-api |

**提供的数据：**

| 方法 | 提供内容 | 实际依赖 |
|------|---------|---------|
| `fetchQuotes()` 场内部分 | ETF/股票实时行情（最新价、涨跌幅） | 腾讯行情 API（`stocks.auto.getStocks()`） |
| `fetchQuotes()` 场外部分 | 场外基金实时估算净值（gsz + 涨跌幅） | **fundgz.1234567.com.cn**（调用 `fetchFundGzJsonp()`） |
| `fetchKLine()` 场内 ETF | K 线 OHLC + 成交量 | **腾讯 K 线 API** |
| `fetchKLine()` 场外基金 | 净值走势（仅收盘价，无 OHLC） | **fund.eastmoney.com/pingzhongdata**（调用 `fetchFundPingZhongData()`） |
| `fetchEtfKLine()` | 场内 ETF 真实 K 线 | **stock-api 腾讯 getKlines()** |
| `fetchFundPortfolio()` | 前十大重仓股 | **pingzhongdata** `Data_fundSharesPositions` |
| `fetchFundInfo()` | 基金/ETF 名称、类型 | 腾讯行情 API（`stocks.auto.getStock()`） |
| `queryEtfMapping()` | OTC → ETF 映射发现 | fundgz 获取名称 → stock-api 搜索匹配 |
| `searchStocks()` | 股票/基金搜索 | 腾讯行情搜索 |

---

### 2️⃣ AKShare / AKTools（第二优先级 ⚠️ 需手动启停）

| 属性 | 值 |
|------|-----|
| 类型 | 外部 **Python HTTP 服务** |
| 调用方式 | 前端 `fetch()` → `http://host:port/api/public/{api_name}` |
| 默认端口 | `http://127.0.0.1:8080` |
| 启动命令 | `python -m aktools --host 0.0.0.0 --port 8080` |
| 需要配置 | ✅ 必须本地运行 AKTools 进程 或 手动设置 `akshareURL` |
| 适配器条件 | `settings.dataSource.akshareURL` 非空 或 `baseURL` 存在时**才加入适配器列表** |

**调用的 AKShare 接口（通过 AKTools HTTP 代理）：**

| AKShare API | 数据内容 |
|------------|---------|
| `fund_name_em` | 全量基金基本信息 |
| `fund_open_fund_daily_em` | 开放式基金日频净值 |
| `fund_value_estimation_em` | 基金盘中估算净值 + 盘后净值 |
| `fund_etf_spot_em` | 场内 ETF 实时行情 |
| `fund_open_fund_info_em` | 基金历史净值走势 |
| `fund_portfolio_hold_em` | 基金持仓明细（前十大重仓股） |
| `fund_open_fund_rank_em` | 开放基金排行 |

> **现状**：服务端已**移除** `akshare_server.py`。前端 `akshare.ts` 仍存在但简化，仅在 `akshareURL` 配置后才激活。实际已**不再依赖**此服务。

---

### 3️⃣ Tushare Pro（第三优先级 🔕 默认未启用）

| 属性 | 值 |
|------|-----|
| 类型 | **HTTP API**（POST JSON） |
| 调用方式 | `fetch()` → `https://api.tushare.pro` |
| 需要配置 | ✅ 用户在设置中填写 **Tushare Token** + 设置 `primarySource: 'tushare'` |
| 默认状态 | ❌ **默认不启用** |

**调用的 Tushare API：**

| API | 数据内容 |
|-----|---------|
| `fund_basic` | 基金基本信息 |
| `fund_nav` | 基金净值 |
| `fund_daily` | 基金日涨跌幅 |

---

### 4️⃣ 东方财富 JSONP 兜底（最低优先级 ✅ 始终可用）

| 属性 | 值 |
|------|-----|
| 类型 | 纯浏览器技术（JSONP / `<script>` 标签） |
| 调用方式 | **开发环境** Vite proxy fetch → **生产环境** `<script>` JSONP |
| 需要配置 | ❌ 无需任何配置 |
| 适配器 `eastmoney.ts` | 始终作为兜底加入适配器列表 |

**两个端点：**

#### A. fundgz（实时估算净值）
```
开发: GET /fundgz/js/{code}.js → Vite proxy → https://fundgz.1234567.com.cn/js/{code}.js
生产: <script src="https://fundgz.1234567.com.cn/js/{code}.js">
返回: jsonpgz({ fundcode, name, jzrq, dwjz, gsz, gszzl, gztime })
用途: 场外基金实时估算净值（主力数据源）
```

#### B. pingzhongdata（基金历史全量数据）
```
开发: GET /pingzhongdata/pingzhongdata/{code}.js → Vite proxy → https://fund.eastmoney.com/pingzhongdata/{code}.js
生产: <script src="https://fund.eastmoney.com/pingzhongdata/{code}.js">
返回: 注入多个全局变量（Data_netWorthTrend、Data_fundSharesPositions 等）
用途: 净值走势、持仓穿透、资产配置、基金经理等信息
```

---

## 二、辅助数据源

### 5️⃣ AI API 分析（✅ 可选，需配置）

| Provider | API 端点 | 默认模型 | 用途 |
|----------|---------|---------|------|
| DeepSeek | `api.deepseek.com/v1/chat/completions` | `deepseek-chat` | AI 诊断、K 线分析 |
| OpenAI | `api.openai.com/v1/chat/completions` | `gpt-4o` | 同上 |
| Groq | `api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile` | 同上 |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o` | 同上 |
| Google | `generativelanguage.googleapis.com` | `gemini-2.0-flash` | 同上 |
| Custom | 用户自定义 | 用户自定义 | 同上 |

---

### 6️⃣ GitHub Gist 备份（✅ 可选，需配置）

| 属性 | 值 |
|------|-----|
| API | `https://api.github.com/gists` |
| 需要 | GitHub Personal Access Token（gist scope） |
| 用途 | 持仓数据备份与同步 |

---

### 7️⃣ IndexedDB 本地存储（✅ 始终可用）

| 属性 | 值 |
|------|-----|
| 依赖 | `dexie@^4.4.3` |
| 用途 | 用户持仓、计划、设置、ETF 映射、行情缓存等全部本地持久化 |

---

## 三、UI 组件 → 数据源映射

| UI 功能 | 方法调用 | 实际使用的数据源 |
|---------|---------|----------------|
| 持仓管理 → 最新净值 | `useRealtimeQuotes` → `dataSourceService.fetchQuotes()` | **stock-api**（场外基金走 fundgz） |
| 持仓管理 → 实时涨跌 | 同上 | 同上 |
| 持仓管理 → 实时盈亏 | 同上 | 同上 |
| 基金详情 → 最新净值 | `useRealtimeQuotes` → 同上 | 同上 |
| 基金详情 → K 线图 | `dataSourceService.fetchEtfKLine()` / `fetchKLine()` | **stock-api 腾讯 K 线**（ETF）/ **pingzhongdata**（场外） |
| 基金详情 → 重仓股 | `dataSourceService.fetchFundPortfolio()` | **pingzhongdata** |
| 基金详情 → AI 分析 | `analyzeKline()` → AI provider API | **配置的 AI API** |
| 基金详情 → Prompt 生成 | 无数据源，纯前端计算 | 本地位运算 |
| Dashboard → 汇总 | `useRealtimeQuotes` → 同上 | **stock-api**（fundgz） |
| 设置 → 持仓导入/导出 | GitHub Gist / CSV / Excel | **GitHub API** / **浏览器本地** |

---

## 四、Vite Proxy 配置（仅开发环境）

```typescript
proxy: {
  '/fundgz'        → https://fundgz.1234567.com.cn       （活跃 ✅）
  '/pingzhongdata' → https://fund.eastmoney.com          （活跃 ✅）
  '/aktools'       → http://127.0.0.1:8080               （保留遗留，未删除）
}
```

> 生产环境（GitHub Pages）下无 Vite proxy，改为 `<script>` JSONP 方式加载。

---

## 五、实际数据流总结

```
用户操作 → UI 组件
  ↓
useRealtimeQuotes(fundCodes)       ← 持仓管理、Dashboard
loadQuotes / fetchQuotes           ← 基金详情
fetchKLine / fetchEtfKLine        ← K 线图
fetchFundPortfolio                 ← 重仓股
  ↓
dataSourceService.fetchXxx()
  ↓  按优先级逐个尝试
① stock-api（npm 包，fundgz + 腾讯行情） ← ✅ 当前主要走此路径
② AKShare（需启动 python -m aktools）    ← ⚠️ 需额外启动
③ Tushare（需配置 Token）                ← 🔕 默认未启用
④ EastMoney JSONP（fundgz + pingzhongdata）← ✅ 兜底
  ↓
返回第一个有效结果
```

**实际运行时只用了两个数据源：`stock-api`（首选）和 `EastMoney JSONP`（兜底）**。AKShare 和 Tushare 在默认配置下**不会被激活**。
