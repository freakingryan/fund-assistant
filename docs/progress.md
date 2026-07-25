# 进度日志

[2026-07-22 20:07] 创建执行计划（A→C→D），开始 Phase A（NAV 原生因子）。

## 实施完成（A→C→D + Worker）

### 工作流 A — NAV 原生因子（净值基金提分）

- `src/services/decision/navFactors.ts`：零新数据源算动量/波动/回撤/收益风险比；`n<5` 返 `available:false`，窗口自适应降级。
- `decisionEngine.ts`：基础权重新增 `navmom:12`；仅当 `nav.available` 时计入基础加权（不破坏 ETF 基金基线评分）；`collectNavSignals()` 生成 navmom 信号。

### 工作流 C — 市场 regime 因子（剥离 beta 伪信号）

- `src/services/decision/regimeFactor.ts`：`computeMarketRegime()` 取 510300 的 3m K 线算 momentum60 + MA20/MA60 排列；失败/不足返 `FALLBACK`(neutral)。
- `decisionEngine.ts`：regime 折扣（bear 市对 dev>0 打折、bull 市对 dev<0 打折）；压缩软化 `compFactor = nav?.available ? 0.9 : 0.7`。

### 工作流 D — 东财 overlay（可用增强 + graceful degradation）

- `src/services/decision/eastmoneyFactors.ts`：`EmFactors` + `EMPTY_EM_FACTORS`；`buildEmFromResults()` 规整已有门控分析结果；`collectEastmoneyFactors()` 并行三函数 `.catch(()=>null)`。
- `decisionEngine.ts`：em overlay 有界增量（资金/板块 ±5、排名 ±5、合计 ±12 封顶）；`available:false` 时增量恒为 0 → 不影响评分。
- `decisionSnapshot.ts`：重排取数顺序（先 capital/sector/rankHist → buildEmFromResults → getDailyRegime 缓存 → buildDecision）；快照增 `regimeMomentum60`。
- `FundDetailPage.tsx` / `DecisionAdvisorCard.tsx`：仅 `eastmoneyConfig.enabled` 时取东财因子，否则 `Promise.resolve(undefined)`，UI 透明展示可用/未接入。

### Cloudflare Worker 接入（「最后做 worker」）

- `worker/index.js`：反代 eastmoney，读 `x-upstream-host` 还原上游 URL，仅放行 `*.eastmoney.com`，附 CORS + OPTIONS 预检。
- `src/services/eastmoneySdk.ts`：proxy 改写时通过 `x-upstream-host` 请求头带原始东财 host（修复丢失上游信息）。

### Phase 3 (impeccable) — 决策卡 UI/UX

- `DecisionAdvisorCard.tsx` 重写：透明展示市场 regime 徽章（bull/bear/neutral + 动量）、东财叠加层三因子状态条（可用显分值、不可用显「未接入」以体现 graceful degradation）、NAV 因子启用提示、emDelta/regime 调整展示；补 a11y（评分条 role/aria-label）+ 微动效。
- `types.ts` / `decisionEngine.ts`：新增 `emDelta` / `regimeAdjusted` / `navAvailable` 字段并随 `Decision` 返回。

### Phase 4 (code-simplifier)

- 删除死代码 `navFactors.ts` 的 `clamp`；`regimeFactor.ts` / `decisionEngine.ts` 关键阈值（overlay 边界 ±5/±12、regime 阈值 ±5/15、conflict 0.4、EM 中性 50）提取为具名常量。

### Phase 5 (setup-pre-commit)

- 安装 `lint-staged` + `prettier`；新增 `.prettierrc.json`（与代码风格一致：2 空格/双引号/分号/trailingComma all）。
- `.husky/pre-commit` 在既有 `tsc --noEmit` + ESLint + `vite build` 强门禁前，新增 `npx lint-staged`（Prettier 自动格式化并重新暂存）。

## 验证结果（最终门禁全绿）

- `tsc --noEmit`：**0 errors**（项目级，此前基线 `Rating` 错误已消除）。
- ESLint：**0 errors**（仅 `FundDetailPage` 既有 warnings + `eastmoneySdk` 一处既有 `as any`）。
- `vite build`：**success**。
- `lint-staged`：**success**（格式化 14 个文件，exit 0）。

## 下一步（待用户）

- 部署 `worker/index.js` 到 Cloudflare（见 `docs/plan-factor-improvements.md` 附录），并在设置页开启东财数据源后，overlay 因子即生效且不影响纯本地评分。
- 未自动 commit / push（遵循协作约定，待用户指示）。
