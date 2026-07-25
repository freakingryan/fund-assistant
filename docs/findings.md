# 架构事实（来自代码核对，2026-07-22）

- `CAT_WEIGHT` 硬编码于 `decisionEngine.ts`：`trend30 / bias20 / momentum15 / volume15 / macd10 / pattern10`。
- 净值压缩：`decisionEngine.ts` `isLowConf` 分支 `score = 50 + (score - 50) * 0.7`，压缩后上限 85。
- 净值基金收到的 `klines` 即 NAV 收盘价序列 → 可零新源算动量/波动/回撤（当前仅算 BIAS/ROC）。
- `NAV_INDICATORS`（`stockSdkIndicators.ts`）仅含 `BIAS / ROC`。
- 资金面(`capitalFlowAnalysis`) / 板块(`sectorStrengthAnalysis`) / 同类排名 均门控东财；经 Cloudflare Worker 代理后可用，但必须 graceful degradation（不可用→`available:false`→增量 0→不影响评分）。
- 设计原则：东财因子用 **overlay 模型**（有界增量 ±12），不重算 `CAT_WEIGHT`、不改变基础分尺度；缺省 0。
- baseline 本就有 26 个无关 `tsc -b` 错误（circuitBreaker 的 erasableSyntaxOnly、ImportDialog、PlansPage、fundCodeRepair 等），本项目靠 `vite`(esbuild) 构建，不依赖严格 tsc。
- `buildDecision` 输出 `Decision`（含 `rating`/`score`/`axisScores` 等）。
- 回测快照已含 `valueSource`（`etf`/`nav`/`unknown`），可区分数据源。
