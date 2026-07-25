# 评分引擎因子增强 — 执行计划

> 来源计划：`docs/plan-factor-improvements.md`
> 执行顺序（用户指定）：**A → C → D（worker 接入最后做）**
> 硬约束：东财因子必须 graceful degradation（不可用 / 未配置 → 评分与纯本地完全一致）。

## Phase A — NAV 原生因子（纯本地，零网络）

- 新增 `src/services/decision/navFactors.ts`：`computeNavFactors(klines)` → `NavFactors`（动量20/60/120、年化波动、最大回撤、收益风险比），窗口按长度自适应降级。
- `src/services/decision/types.ts`：`SignalCategory` 增 `'navmom'`；`DecisionInputs` 增 `nav?: NavFactors`。
- `src/services/decision/decisionEngine.ts`：`CAT_WEIGHT` 增 `navmom: 12`；新增 `collectNavSignals(nav)`；软化压缩 `×0.7 → ×0.9`（有 nav 依据时）；`signals` 注入 nav 信号。
- 调用点：`DecisionAdvisorCard.tsx` / `decisionSnapshot.ts`（2 处）：NAV 模式计算并传入 `nav`。
- ✅ 验收：净值基金评分可破 60、理由含「NAV 动量」；tsc/vite/eslint 0 error。

## Phase C — 市场 regime 因子（剥离 beta 伪信号）

- 新增 `src/services/decision/regimeFactor.ts`：`computeMarketRegime()` 取沪深300ETF(510300) K 线算大盘状态，失败返 neutral。
- `src/services/decision/types.ts`：`DecisionInputs` 增 `regime?: MarketRegime`。
- `src/services/decision/decisionEngine.ts`：融合后 regime 折扣（bear→bullPower 打折）。
- `src/services/backtest/types.ts`：`ScoreSnapshot` 增 `regimeMomentum60?: number | null`。
- `src/services/backtest/decisionSnapshot.ts`：计算并写入 `regimeMomentum60`。
- ✅ 验收：regime 识别正确；取数失败回 neutral 不崩；tsc/vite/eslint 0 error。

## Phase D — 东财交叉截面因子（worker 接入放最后）

- 新增 `src/services/datasource/eastmoneyWorker.ts`：`fetchViaWorker(path, cfg)`，任何失败返 `null`（不抛）。
- 新增 `src/services/decision/eastmoneyFactors.ts`：`collectEastmoneyFactors(fundCode, cfg)` → `EmFactors`（capitalFlow/sector/peerRank，均带 `available`）。
- `src/services/decision/types.ts`：`SignalCategory` 增 `'capitalflow'|'sector'|'peer'`；`DecisionInputs` 增 `em?: EmFactors`。
- `src/services/decision/decisionEngine.ts`：`emDelta` overlay（每类 ±5，合计 ±12 封顶）加到基础分。
- `settings`：新增 `eastmoneyWorkerUrl`（默认空 = 禁用）。
- 调用点：`DecisionAdvisorCard.tsx` / `decisionSnapshot.ts`：异步取 `em` 传入；失败静默降级。
- 最后做：新增 `worker/` Cloudflare Worker 代理代码（`index.js` + `wrangler.toml`）。
- ✅ 验收：空 URL → 评分与纯本地一致（差值 0，可断言）；配置 URL → 有界增量且理由可见；tsc/vite/eslint 0 error。

## 通用验收门禁（每 phase）

1. 对照 baseline（`git stash` 后 `tsc -b`）确认**未新增** tsc 错误（baseline 本有 26 个无关错误）。
2. `NODE_OPTIONS="" npx vite build` 成功。
3. `NODE_OPTIONS="" npx eslint` 仅改文件 0 error。
4. **不自动 push**（用户未说 push）。
