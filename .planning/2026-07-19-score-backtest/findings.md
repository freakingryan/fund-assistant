# 评分回测验证 — 调研发现（findings）

## 现有数据结构
- Dexie 库 `src/stores/db.ts`：表 holdings / plans / planLogs / settings。需新增 `scoreSnapshots`。
- `BackupData`（`src/services/backup.ts`）：
  ```ts
  interface BackupData {
    version: number; exportedAt: string; appName: string;
    holdings: FundHolding[]; plans: InvestmentPlan[];
    alerts: PlanAlert[]; settings: UserSettings[];
  }
  ```
  `exportAllData()` 用 `Promise.all` 取四表；`importAllData()` 在 `rw` 事务内 clear+bulkAdd。Gist 同步（`syncToGist`）直接序列化整份 BackupData → 加字段即自动备份。

## 决策引擎输出（回测要持久化的核心）
- `src/services/decision/decisionEngine.ts` `buildDecision(...)` 返回 `Decision`：
  - `score: number`（0-100，全页唯一权威分）
  - `rating`：strong_buy/buy/hold/reduce/strong_sell
  - `recommendation`：buy | hold | sell（可执行动作）
  - `bullPower` / `bearPower` / `agreement`
  - `categoryScores?` / `reasons: {buy: string[]; risk: string[]}` / `strategiesHit?: string[]`
- 详情页 `FundDetailPage.tsx` + `DecisionAdvisorCard.tsx` 已用此管线；采集服务复用同一数据获取+分析链路。

## 行情数据源约束（关键）
- 场内 ETF 类（名称含 etf/ETF/指数 且有 etfCode 映射）：走腾讯 K线（`stock-api` 腾讯源，用户网络可达）→ 可稳定取 closeValue 与次日 nextValue。
- 纯基金 NAV 历史：走东财（`pingzhongdata` 等），**用户网络含代理均硬阻断**；需部署 `cloudflare-worker/` 并填 `VITE_FUND_WORKER_URL` 才可达。
- 影响：snapshot 的 `closeValue`/`valueSource`/`nextValue` 对 ETF 类可靠；对纯 NAV 基金为尽力而为（缺失留空，outcome 待补）。UI 需标注此限制。

## 已有能力（可复用）
- `recharts`（依赖）做散点/柱状/趋势图。
- `react-router-dom` v7 路由；现有路由在 `App.tsx` 或路由文件，新增 `/backtest`。
- `src/lib/fundCategory.ts` `isOnExchangeEtfFund(name)` 判断场内ETF类。
- 自动同步 `src/services/autoSync.ts` `runDailyGistPush()` 已有每日节流；回测采集可挂在同一节奏或独立定时器。
- 导出工具：`downloadBackup`/`readBackupFile`（backup.ts）可复用 JSON 导出；CSV 用 `papaparse`（已依赖）。

## 质量门禁现状（本次会话已加固）
- 本地 `.husky/pre-commit`：tsc --noEmit + eslint(暂存) + **vite build**（本次新增）。
- `core.hooksPath=.husky/_`；`package.json` 加 `"prepare":"husky"` + devDep husky → 新机器 npm install 自动激活。
- CI：`.github/workflows/quality.yml`（push/PR to main）跑 eslint+tsc+build；`deploy.yml` 先 quality 再部署 Pages。
- 仓库侧：main 分支保护已开，要求 `lint` 状态检查通过 + enforce_admins（本次 `gh api` 设置）。
- eslint 已加 `@typescript-eslint/no-shadow: error`（防 TDZ 类遮蔽 bug）。
