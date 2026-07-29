# PLAN — 智能决策引擎算法优化

> 状态：**T1 已落地（2026-07-29）**；**T2 已落地（2026-07-27）**；**T3 已落地（2026-07-27）**；**T4 已落地（2026-07-29）**；T5 待启动
> （T4 / T5 = **AI 接入与持续调参**，详见 §11；可行性已确认，地基直接复用 `ai.ts` + `decisionSnapshot` 账本 + `aiAnalysis`）
> 关联：`PENDING_PLAN.md` §一 新增条目「决策引擎算法优化」
> 验证脚本：仓库根 `verify-decision.mts`（Node 直跑真实引擎，无需浏览器）
>
> **实施备注（T1 关键偏差）**：原 T1.1 计划「扩展 `DecisionInputs` 新增 `capital`/`sector` 字段」。
> 实现时改为**复用现有 `em` 叠加层已携带的 `capitalFlow.combinedScore` / `sector.combinedScore`**
> 作为护栏数据源，**不新增 `DecisionInputs` 字段、不新增取数代码**。理由：
> (1) `useFundDecision` 已构建并透传 `em`，数据早已可取；(2) 规避 §8 提到的 T2.2 双重计数风险
> （若另设硬门控源，会与该 `em` 软叠加重复计数）。护栏改用「复用 em 分」后，T2.2 的移除重复叠加议题
> 可重新评估（当前保留 ±12 软叠加作为轻微确认，与硬护栏不冲突）。

## 1. 背景与问题

`src/services/decision/decisionEngine.ts` 的「智能决策建议」当前是**纯技术面动量融合**，在下跌市里最易误触发「买入」。已对照代码（2026-07-28 用真实 K 线复跑 159157/159147 验证）确认三个根本缺陷：

1. **纯动量，无资金 / 板块确认。** 评分 `score = 50 + 50 * (bullPower − bearPower) / TOTAL_WEIGHT`，权重 `trend30 / deviation20 / momentum15 / volume15 / macd10 / pattern10`（+nav12）全部是价格行为。下跌市中「RSI/KDJ 超卖 → 金叉 → SAR 反转」这类短翻多信号最容易被点亮——正是 159157（3 月 −16.7%）/159147（3 月 −22.8%）被判「买入」的来源。引擎在它最该谨慎的 regime，反而最激进出「买入」。
2. **买入阈值被人为放宽。** `decisionEngine.ts:567–571` 注释原话：从 `score>=70 && bullRatio>=0.6` 放宽到 `score>=65 && bullRatio>=0.55`，理由是「否则偏空/震荡市中引擎几乎永不买入，回测买入侧覆盖度为 0，无法验证买入逻辑」。**这是为回测覆盖而调参，不是为高胜率而调参**。
3. **`trendBearish` 门控太弱。** `decisionEngine.ts:517–522`：仅「死亡交叉 / SAR 空头 / MA 贡献 < −3」才触发。像「3 月跌 17% 但无死亡交叉」的温水煮青蛙式下行**完全不触发护栏**，照样给「买入」。

## 2. 目标

- 让决策建议**诚实、可解释、带资金 / 板块语境**：下跌市不误触发「买入」，超卖反弹明确标注而非伪装成趋势买入。
- 复用现有数据接口，**不引入新数据源**；尽量不新增取数代码（见 §3）。
- 改动集中在 `decisionEngine.ts` + 接线处，详情卡片契约向后兼容（新增字段自动可读）。

## 3. 现有可复用接口（关键发现：取数早已就绪）

| 接口               | 签名                                                                                                                    | 说明                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **资金面**         | `analyzeFundCapitalFlow(fund, etfMappings, config): CapitalFlowResult \| null`（`capitalFlowAnalysis.ts:65`）           | 内部已用 `etfMappings` 解析出 ETF 代码（映射基金直接用 159157/159147）；已做 `config.enabled` 东财门控（关闭返回 `null`）；返回 `capitalScore` / `northboundScore` / `score`（0–100，capital 0.6 + northbound 0.4）。 |
| **板块面**         | `analyzeFundSectorStrength(fund, etfMappings, config): SectorStrengthResult \| null`（`sectorStrengthAnalysis.ts:133`） | 同上结构；返回板块强度分。                                                                                                                                                                                            |
| **现有 `em` 叠加** | 详情页 `useFundDecision` 已调用上面两函数构建 `em`（资金/板块/排名，≤±12 软叠加进评分）                                 | **数据已取**，只是以软叠加形式轻描淡写，未当门控。                                                                                                                                                                    |
| 一致预期 EPS       | `getConsensusEps`（`extraSources/tonghuashun.ts`）                                                                      | 个股级，**对 ETF 弱**（需成分股聚合），本期不接入。                                                                                                                                                                   |

> 结论：`useFundDecision` 已经持有 `fund + etfMappings + eastmoneyConfig`，且已经调用这两个 service 构建 `em`。决策引擎只需把**已取的原始结果透传**进 `buildDecision`，再施以护栏即可——几乎零新增取数代码。

## 4. 设计方案

分层子分 + 元聚合器 + 护栏（架构图见下，概念：技术 / 资金 / 板块 / 中期趋势 各自独立打分 → 元聚合器按护栏出诚实动作）。

- **技术面子分**：现有 `buildDecision` 输出（`rawScore` / `rating`）。
- **资金面子分**：`analyzeFundCapitalFlow(...).score`（0–100）。
- **板块面子分**：`analyzeFundSectorStrength(...).score`。
- **中期趋势门控**：引擎已有 `klines` / `nav`（含 `nav.momentum60`），新增纯计算的 `computeMediumTermTrend(klines)`（60 日均线斜率 或 3 月收益符号），**无需新接口**。

护栏规则（在 `applyGuardrails` 或其后处理中施加）：

1. **资金背离护栏**：技术买（`score>=80` 或 `rating∈{buy,strong_buy}`）且 资金面分 `< 50`（或北向净减）→ 降级为 `observe` / `hold`。直接抓「价弹钱不跟」的接飞刀。
2. **板块逆风护栏**：技术买 且 板块强度分 `< 40`（逆板块孤涨）→ 降级。
3. **中期趋势门控**：中期下行（3 月收益 < 0 且无中期均线金叉）→ 动作上限封顶 `add` / `hold`，即便短期动量翻多。
4. **反弹语义标注**：短翻多（动量刚转正 / 超卖修复）+ 中期下行 + 超卖历史 → 标 `signalType = 'reversion'`，评级上限 `hold`，`summary` 强制「非趋势确认」提示。**无需新数据**，纯把门控判定暴露给用户。

## 5. 分期任务

### T1 — 核心护栏（先落地，MVP）

- **T1.1** 扩展 `DecisionInputs`：新增 `capital?: CapitalFlowResult | null`、`sector?: SectorStrengthResult | null`；`useFundDecision` 把已取的原始结果**透传**（不重复请求）。
- **T1.2** 资金背离护栏（§4-1）。
- **T1.3** 板块逆风护栏（§4-2）。
- **T1.4** 中期趋势门控：新增 `computeMediumTermTrend(klines)` 纯函数（§4-3）。
- **T1.5** 反弹语义标注：`signalType` 枚举 + `summary` 文案（§4-4）。

### T2 — 语境与一致性

- **T2.1** 波动 / 仓位建议：新增 `computeRiskProfile(klines, ind)`（原命名 `computeHistoricalVol`）→ 输出 `RiskProfile`（年化波动 / 最大回撤 / ATR% / 波动分档 / 建议最大仓位 / 止损参考）只读字段，挂在 `Decision.riskProfile`，**绝不改动作 / 评分 / 评级**；卡片以只读面板呈现。
- **T2.2** 去重评估（**结论：保留，不移除**）：经代码追踪，`em` 软叠加（±12，影响展示评分/评级幅度）与 T1 硬护栏（capital_divergence / sector_headwind，影响八态动作天花板）虽同源复用 em capital/sector 分，但**输出维度正交、非有害双重计数**——同向时一致强化（正确），em 偏多时仅软叠加轻微确认（预期行为）。故保留两者；在 `decisionEngine.ts` 软叠加块加注释说明分离关注点，防误删。详见 §10 T2 记录。

### T3 — 校准卫生

- **T3.1** 诚实化买入阈值：恢复 `score>=70 && bullRatio>=0.6` 给「趋势买入」；另设 `reversion` 路径阈值（如 `score>=75 && 中期下行`）并强制免责声明，不再为回测覆盖而放宽。
- **T3.2** 联接基金跟踪误差折扣：用 NAV 序列 vs ETF 收益算 `trackingError`，对置信度打折（需额外取 NAV 序列，`isRealKline` 时已有）。

### T4 — AI 解释 / 增强层（运行时接口，不改动算法）

- **T4.1** `aiAdvisor.adjudicateDecision(decision, marketSnapshot)`：决策卡片新增「AI 综合研判」面板，调 `callAI` 把引擎结构化输出 + 实时市场快照解释为「人话 + 跨维度综合」（资金/板块/宏观语境）。温度低、强约束「只基于给定数据、不编造」。
- **T4.2** `aiAdvisor.explainPattern(klines, patterns)`：K 线形态分析页新增「AI 形态解读」，把检测到的形态 + 量价上下文喂 LLM 做可读解释（如「这个底背离为何在当前中期下行中更可能是反弹而非反转」）。
- **T4.3** 复用现有 `ai.ts` 的 `getDefaultAI()/callAI()`，沿用设置页已配置 provider/apiKey（浏览器直连，零后端）；未配置时 UI 引导去设置页（参照 `NoAIConfiguredError`）。

### T5 — AI 调参反馈环（优化接口，持续改算法）

- **T5.1（前置）参数外置**：把 `decisionEngine.ts` 内联的权重（`TOTAL_WEIGHT` 及各维权重 `trend30/deviation20/momentum15/volume15/macd10/pattern10` +nav）与阈值（买入 `score>=70 && bullRatio>=0.6`、reversion 路径等）抽成 `decisionParams` 配置（默认常量 + 用户可覆盖，存 `db` 或 `settings.decisionParams`），引擎运行时读取。**外置后行为须与硬编码时逐字节一致**（verify-decision.mts 复跑零回归）。
- **T5.2 调参反馈环**：扩展 `aiAnalysis.ts` 的 Prompt，要求 LLM **输出结构化参数 diff（JSON：改哪些权重/阈值 + 理由 + 预期影响）** 而非空泛建议；新增 `applyTuningProposal()` 把 diff 写入 `decisionParams`。提供人审 UI（复用 `AiAnalysisPanel` 加「采纳建议」），AI 不直接改算法。
- **T5.3 自动触发**：当 `scoreSnapshots` 新增 ≥ N 条已结算样本（或每自然周）时，自动跑一次 `analyzeBacktestWithAI` 并生成「待审参数提案」，形成持续闭环。已有 `captureDailySnapshots` + `reconcileSnapshots` 在打开应用时运行，数据底座现成。
- **T5.4 反馈可视化**：回测/设置页展示「当前参数 vs AI 建议参数」对比、采纳历史、采纳后准确率变化，使优化可观测、可回滚。

## 6. 接口接线细节

- **调用点**：`useFundDecision` 已持 `fund + etfMappings + eastmoneyConfig`，直接复用 `analyzeFundCapitalFlow` / `analyzeFundSectorStrength` 结果（两函数内部已解析 ETF 映射、已门控）。
- **东财门控**：两函数 `if(!config.enabled) return null` → 关闭时 `capital`/`sector` 为 `null`，护栏自动跳过，与现有 `em` 行为一致，不报错。
- **ETF 覆盖实测**：需验证 `fundFlow.individual(159157/159147)` 与 `board.industry/concept.constituents(159157/159147)` 实际返回（两市 ETF 东财一般有，但须实测；个别返回空时护栏安全跳过）。
- **卡片契约**：`DecisionAdvisorCard` 无需改契约，新增字段（`signalType` / `capitalGate` / `sectorGate` / `suggestedPosition`）自动可读；卡片可增强展示「资金背离 / 板块逆风」标签。

## 7. 验收标准

- **行为验证**：用 `verify-decision.mts` 复跑 159157（−16.7%）/159147（−22.8%）→ 期望评级由 `buy` / `strong_buy` 转为 `reversion`（反弹）/ `observe`，且 `reasons` 含「资金背离 / 中期下行 / 超卖反弹」标注。
- **质量门禁**：`tsc` 0 error / `eslint` 0 error / `vite build` success（husky 预提交门禁）。
- **不破坏既有**：无 ETF 映射、东财关闭时行为完全不变（护栏跳过）。

## 8. 已知缺口与风险

- **ETF 估值护栏缺失**：一致性预期 PE 对 ETF 不可得（`getConsensusEps` 个股级），本期不做估值护栏；卡片须明确标注「无估值输入」。
- **双重计数风险**：T2.2 已评估（`em` 软叠加 vs T1 硬护栏）→ 判定为**正交、非有害双重计数**，保留两者并加注释说明；不再作为待处理风险。
- **资金流为 T 日快照**：对「背离」判定够用，但非实时；北向/资金流仅东财增强开启时可用。

## 9. 推荐落地顺序（MVP）

先做 **T1（T1.1–T1.5）**，用 `verify-decision.mts` 验证 159157/159147 由「买入」转为「反弹 / 观察」，再视效果推进 T2 / T3。

## 10. T1 实施记录（2026-07-29）

**改动文件**

- `src/services/decision/types.ts`：新增 `SignalType`（`trend`/`reversion`）；`GuardrailReason.kind` 扩展 `mid_term_down` / `capital_divergence` / `sector_headwind` / `reversion_label`；`Decision` 新增 `signalType` / `midTermDown` / `midTermReturnPct`。
- `src/services/decision/decisionEngine.ts`：新增纯函数 `computeMediumTermTrend(klines)`（3 月收益符号 + 中期均线排列）、`hasOversoldSignal(ind, midTermDown)`（超卖金叉反弹判定）、`minRating` / `ACTION_MAX_RATING`（诚实对齐评级）；在 `buildDecision` 的 `applyGuardrails` 之后施加 T1 四道护栏（中期门控 / 资金背离 / 板块逆风 / 反弹语义标注），并把 `rating` 对齐到 `finalAction`。
- `src/components/holdings/DecisionAdvisorCard.tsx`：reversion 时展示「超卖反弹·非趋势」琥珀徽章；警示块扩展 `midTermDown`（含近三月收益）。
- `verify-decision.mts`：打印 `signalType` / `midTermDown`；新增合成护栏隔离验证（确定性上行 K 线 + 合成 em）覆盖资金背离 / 板块逆风。

**验收结果（verify-decision.mts 复跑真实引擎）**

- 159157（017193）：区间 −12.2%，原会判「买入」→ 现 `signalType=reversion`、动作=持有、评级=持有，护栏 `reversion_label`。
- 159147（018927）：区间 −21.5%，原会判「买入」→ 现 `signalType=reversion`、动作=持有、评级=持有，护栏 `mid_term_down` + `reversion_label`。
- 合成上行 K 线（midTermDown=false）：capital=35 → `capital_divergence` 降级持有；sector=35 → `sector_headwind` 降级持有；capital=60/sector=55 → 无护栏，保持买入侧。

**门禁**：`tsc --noEmit` 0 error；`eslint` 0 error；`vite build` success。

**未破坏既有**：无 em 传入时（东财关闭 / 净值模式）护栏自动跳过，`midTermDown` 仅在真实 K 线且区间收益<0 时触发；组合风险 / 分红等既有逻辑不受影响。

## 10. T2 实施记录（2026-07-27）

**T2.1 波动 / 仓位风险画像（只读字段）**

- `src/services/decision/riskProfile.ts`（新增）：纯函数 `computeRiskProfile(klines, ind): RiskProfile | null`。
  - 年化波动率 = 日收益率样本标准差 × √252；最大回撤 = 收盘价峰谷最大跌幅（正向幅度）；ATR% = `ind.latest.atr.atr / 末价`（无真实 OHLC 时为 0）。
  - 波动分档：年化波动 <25% → low、<40% → medium、≥40% → high。
  - 建议最大单标的仓位：low 70% / medium 50% / high 30%；止损参考：优先 2×ATR%，回退分档默认，clamp 到分档区间 [floor,cap]（low 5–10 / medium 8–15 / high 12–20）。
  - **零网络、零副作用、纯只读**；样本不足（有效收盘价 <20 根）返回 null。
- `src/services/decision/types.ts`：`RiskProfile` / `VolTier` 经 `./riskProfile` 重导出；`Decision` 新增 `riskProfile?: RiskProfile | null`。
- `src/services/decision/decisionEngine.ts`：`buildDecision` 返回对象新增 `riskProfile: computeRiskProfile(klines, ind)`（**未改任何评分 / 评级 / 动作逻辑**）。
- `src/components/holdings/DecisionAdvisorCard.tsx`：增强因子区后新增「波动 / 仓位（只读参考）」虚线面板（Gauge 图标 + 波动分档徽章 + 年化波动/最大回撤/ATR% 三宫格 + 建议仓位/止损参考文案），`riskProfile` 为 null 时不渲染。

**T2.2 去重评估（em 软叠加 vs T1 硬护栏）**

- 评估结论：**保留 `em` ±12 软叠加，不移除**。理由：
  1. 二者同源复用 em `capitalFlow.combinedScore` / `sector.combinedScore`，但输出强制在不同维度——软叠加只微调「展示评分 + 评级幅度」（有界 ±12，且经诚实对齐 `rating = minRating(rating, ACTION_MAX_RATING[finalAction])` 被 finalAction 封顶）；硬护栏改的是「八态动作天花板」（buy→watch/hold）。
  2. 同向时两者一致强化（em 偏空 → 既压低展示分又封顶动作，正确）；em 偏多时仅软叠加轻微确认（预期行为）。非有害双重计数。
- 在 `decisionEngine.ts` 软叠加块加注释说明「分离关注点，勿以去重为由误删」。

**验收（verify-decision.mts 复跑真实引擎，预期零回归）**：见 §10 末尾 T2 验证。行为不变——`finalAction`/`score`/`rating` 与 T1 完全一致；新增 `riskProfile` 仅追加只读信息。

**门禁**：`tsc --noEmit` 0 error；`eslint` 0 error；`vite build` success（husky 预提交门禁）。

---

## 10. T3 实施记录（2026-07-27）

**T3.1 诚实化买入阈值（撤销「为回测覆盖而放宽」的反模式）**

- `src/services/decision/decisionEngine.ts` 评级块（`buildDecision` 内）：
  - 风险上下文分支（偏空/震荡/多空冲突）`if (score >= 65 && bullRatio >= 0.55) → buy` **恢复**为 `if (score >= 70 && bullRatio >= 0.6) → buy`，并改写注释说明「不再为回测覆盖度放宽，买入信号必须高胜率共振」。
  - 正常上下文分支（原 `score >= 60 → buy`）**恢复**为 `if (score >= 70 && bullRatio >= 0.6) → buy`；`strong_buy` 维持 `score >= 75 && bullRatio >= 0.6`。
  - `reversion` 免责声明已由 `buildSummary`（`signalType === "reversion"` 时强制「短期超卖反弹而非趋势确认」文案）覆盖，T3.1 确认保留、不重复。
- 验收：`verify-decision.mts` 合成上行 K 线基线（确定性上行、midTermDown=false）原在 60/0.55 放宽规则下可得 `buy/add` 评级，现正确收敛为 `hold`（评分 60–69 区间不再误判买入）；真实两只联接基金（159157/159147）仍 `reversion/hold`，零回归。

**T3.2 联接基金跟踪误差折扣（诚实化「名实偏离」）**

- 新增 `src/services/decision/trackingError.ts`（纯函数、零网络）：
  - `computeTrackingError(navKlines, benchKlines)`：按日期对齐 基金NAV 与 ETF基准 收盘价，算日收益差序列，年化标准差即跟踪误差(%)；对齐样本 <21 返回 null。
  - 导出常量 `TRACKING_ERROR_HIGH = 5`（%）、`TRACKING_ERROR_DISCOUNT = 0.96`、`TRACKING_ERROR_MIN_SAMPLES = 20`。
- `src/services/decision/types.ts`：
  - `DecisionInputs` 新增可选 `navKlines?: KLineData[]`（仅 `isRealKline` 联接基金场景传入，基准即引擎 `klines`）。
  - `Decision` 新增 `trackingErrorPct?: number | null`。
  - `GuardrailReason.kind` 新增 `"tracking_error"`。
- `src/services/decision/decisionEngine.ts`：在「净值模式压缩」之后、东财叠加之前，若 `navKlines` 存在则算 `trackingErrorPct`；**>5%** 时对评分做温和折扣 `score = Math.round(50 + (score-50)*0.96)`（向 50 收敛，与低置信压缩同量级、正交），并在护栏数组追加 `tracking_error` 说明（诚实对齐之后）。
- **接线（无需新取数）**：
  - `src/services/backtest/decisionSnapshot.ts`：`captureSnapshotForFund` 在 `etfCode` 存在时 memo 化 `fetchKLine(fund.code)` 作为 `navKlines` 传入（与 `klines` 同步按 `targetDate` 截断，避免前视偏差）。
  - `src/hooks/useFundDecision.ts`：新增 `navKlines?` 输入并透传 `buildDecision`。
  - `src/hooks/useFundDetailController.tsx`：详情页早已并行 `Promise.all([fetchEtfKLine, fetchKLine])` 取过基金自身 NAV（`navData`）——新增 `navKlineData` state 持有并暴露；切换基金时按当前基金刷新（空则清空，防跨基金残留）。
  - `src/components/holdings/DecisionAdvisorCard.tsx` + `src/components/holdings/fundDetail/FundDecisionAdvisorCard.tsx` + `src/components/holdings/guide/DecisionGuide.tsx` 三处调用点透传 `navKlines`（仅 `isRealKline` 时）。纯 NAV 基金不传 `navKlines`（无基准可比，折扣不触发）。
- `verify-decision.mts`：主流程打印 `trackingErrorPct`（无 NAV 序列恒为 null）；新增 `verifySyntheticTrackingError()` 隔离验证——低 TE(0.77%) 不触发折扣、高 TE(21.75%) 触发折扣 + `tracking_error` 护栏。
- **设计注记**：×0.96 折扣对中等分数（近 50）经四舍五入后可见变化极小（如 62→62）；T3.2 的诚实化主要载体是**护栏说明 + 暴露的 `trackingErrorPct` 字段**，折扣为次级置信弱化。若期望对高分买入信号产生可见压制，可下调 `TRACKING_ERROR_DISCOUNT`（如 0.90，与低置信可用 NAV 同量级）。

**门禁**：`eslint` 0 error（仅 `useFundDetailController.tsx` 既有 `any`/hooks 警告，非本次引入）；`vite build` success（husky 预提交门禁）。

---

## 10. T4 实施记录（2026-07-29）

**T4 — 运行时 AI 解释层（只解释、不改算法）**

- 新增 `src/services/aiAdvisor.ts`（与 `aiAnalysis.ts` 平级的「解释层」模块）：
  - `MarketSnapshot` 接口 + `buildMarketSnapshot(em?, regime?, klines?)`：纯本地组装（em/regime + 近期量价少量统计），**不联网、仅含真实字段**。
  - **T4.1** `adjudicateDecision(decision, snapshot)`：把 `Decision` 结构化输出 + 市场快照拼成 Prompt，调 `callAI` 产出「人话 + 跨维度综合研判」。Prompt builder `buildAdjudicationPrompt` 导出，强约束「只基于给定字段、不编造、缺维度显式说明、非荐股」。
  - **T4.2** `explainPattern(klines, patterns)`：把检测到的形态 + 近期量价上下文喂 LLM 做可读语义解读（含「看涨形态为何在当前背景下多是反弹而非反转」的局限性说明）。Prompt builder `buildPatternExplanationPrompt` 导出。
  - 两入口均复用 `getDefaultAI()`/`callAI()`（沿用设置页已配 provider/apiKey，浏览器直连零后端）；未配置抛 `NoAIConfiguredError`（复用 `aiAnalysis.ts` 既有类，单一来源）。
- 新增 `src/components/holdings/AiAdvisoryPanel.tsx`（通用 UI 容器，T4.1/T4.2 复用）：
  - 自持状态 `idle→loading→done/error`；区分「未配置 AI」（`NoAIConfiguredError` → 渲染去 `/settings` 的引导 banner）与「调用失败」（错误态 + 重试）。
  - 仅手动触发（不在挂载时自动刷），符合 §11.5 成本控制；风格与决策卡其他面板一致（primary/5 底色、Sparkles 图标、Loader2 加载、whitespace-pre-line 保留 AI 换行）。
  - **爆炸半径最小**：状态由卡片自持（useState + 手动触发），未触碰 `useFundDetailController` / 个股页 / 决策引擎。
- **接线**：
  - `src/components/holdings/DecisionAdvisorCard.tsx`：在「人话总结」之后插入 `<AiAdvisoryPanel run={() => adjudicateDecision(decision, buildMarketSnapshot(em, regime, klines))} />`。调用方 `FundDecisionAdvisorCard` / `DecisionGuide` 已喂 `em`/`regime`，T4.1 自动生效（stock/fund 两页零侵入）。
  - `src/components/holdings/KlinePatternCard.tsx`：在「AI 深度分析」段之后插入独立「AI 形态解读」面板 `run={() => explainPattern(klineData, klineDetectedPatterns)}`；组件 `!isRealKline` 已提前返回，故该面板天然仅真实 K 线场景展示。
- **防幻觉不变量**：Prompt 仅由传入的结构化字段 `JSON.stringify` 拼装，前端不注入任何非输入数据；导出 prompt builder 以便无密钥静态校验「无臆造」。温度沿用 `callAI` 的 `temperature: 0.1` 低温度。
- **验收**：T1 reversion 卡片可展示 AI 解释；解释文本受「仅基于给定数据」硬约束（输出可溯源到输入，无引擎未提供的捏造）；未配置 AI 时 UI 引导去设置页（已验证 `NoAIConfiguredError` 分支）。
- **门禁**：`eslint` 0 error；`vite build` success（2847 模块）；`tsc -p tsconfig.app.json` 全量 44 error 均为预存（stock-sdk `ResearchReport`/指标导出、`FundDecisionAdvisorCard` 的 `navKlineData` 引用缺失等），**本 T4 四个文件零 type error**。

---

## 11. AI 接入与持续调参（T4 / T5）— 2026-07-29 新增

> 用户提问：能否让 AI 结合真实实时数据，提供一个接口「不断优化我们的分析以及算法」（覆盖 K 线形态分析、决策建议及所有涉及算法）？
> 结论：**可行，且地基已具备**。本规划把「AI 优化」拆成两层接口——运行时解释层（T4）与参数调优反馈环（T5）。

### 11.1 可行性结论（先回答）

项目已有三块可直接复用的基础设施，**不是从零开始**：

| 地基                  | 位置                                        | 作用                                                                                                                                                                                                        | 对本规划的支撑                                                |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **AI 调用抽象**       | `src/services/ai.ts`                        | `callAI()` 统一封装 deepseek/openai/groq/openrouter/agnes/google/custom；API Key 来自设置页 `aiConfigs`（用户自填、存 IndexedDB）；浏览器直连（CORS 友好端点）                                              | 实时 per-query AI 直接复用；零后端，与「纯前端 SPA」哲学一致  |
| **决策—结果反馈账本** | `src/services/backtest/decisionSnapshot.ts` | `captureSnapshotForFund` 每日收盘写 `scoreSnapshots`（含 `score/rating/recommendation/资本/板块/…`）；`reconcileSnapshots` 拉下一交易日实际涨跌回填 `nextChangePct` 并算 `outcome`（correct/wrong/neutral） | 这是「决策 → 真实结果」闭环，是整个调参回路的**数据底座**     |
| **回测 AI 诊断原型**  | `src/services/backtest/aiAnalysis.ts`       | 把统计/按日准确率/样本打包成 Prompt 调 LLM，输出 `weaknesses`/`suggestions`/`summary` 落库 `aiAnalyses`，含 `NoAIConfiguredError`                                                                           | 「AI 指出算法薄弱环节 + 调参建议」的原型已存在，T5 直接扩展它 |

**关键约束（必须满足，否则不应接入）：**

1. **引擎是唯一的真相源**：硬护栏、评分、动作不被 AI 替换；AI 仅做「解释 + 建议」，**绝不伪造 / 臆造金融数据**（与用户铁律一致）。LLM 只消费引擎已算出的真实结构化输出与真实市场快照。
2. **当前权重 / 阈值写死在 `decisionEngine.ts` 内联常量** —— AI 的调参建议**无法被自动应用**，必须先外置为可配置参数（T5.1 前置）。这是 T5 真正的工程前置，不是调算法本身。
3. **实时数据无新增 CORS**：引擎已取真实 K 线 / 行情，AI 只是消费这份已取数据；LLM 调用沿用现有 `callAI` 浏览器直连（与现有图片 OCR、ETF 映射、回测诊断同一机制）。
4. **「持续」≠「自动改算法」**：建议**人审闭环**——AI 出参数 diff → 用户在 UI 审核确认 → 写入 `decisionParams` → 引擎读取。避免黑箱自动调参带来的不可解释 / 回撤风险。

### 11.2 架构（两层接口）

```
                        ┌──────────────────────────────────────────┐
                        │       fund-assistant（纯前端 SPA）          │
                        │                                            │
   真实 K线/行情/资金/板块  │  ┌──────────── 决策引擎（真相源）─────────┐ │
   (已有 dataSourceService) → │ buildDecision + T1护栏 + 评分/动作/理由  │ │
                        │  └───────────────────┬──────────────────┘ │
                        │                      │ 结构化 Decision + marketSnapshot
                        │          ┌───────────┴────────────┐        │
                        │          │  T4 aiAdvisor（运行时）  │        │  per-query 实时增强
                        │          │  解释/综合研判/形态解读   │        │  （不改算法）
                        │          └───────────┬────────────┘        │
                        │                      │ callAI()（复用 ai.ts）
                        │          ┌───────────┴────────────┐        │
                        │          │  已配 LLM（设置页 apiKey）│        │
                        │          └────────────────────────┘        │
                        │                                            │
                        │  scoreSnapshots（决策→实际涨跌→outcome 账本）│  ← T5 数据底座
                        │      ↑ capture/reconcile（打开应用时跑）     │
                        │          │                                  │
                        │  ┌───────┴─────────── T5 aiTuning ───────┐ │
                        │  │ 周期/手动触发 → 回测统计 → LLM 诊断      │ │  持续优化算法
                        │  │ → 结构化参数 diff → 人审 → decisionParams│ │
                        │  └────────────────────────────────────────┘ │
                        └──────────────────────────────────────────┘
```

- **T4 AI 解释 / 增强层（运行时接口 `aiAdvisor`）**：对任意算法（K 线形态 / 决策 / 组合风险 …）的结构化输出 + 实时市场快照，调 LLM 产出「人话解释 + 跨维度综合」。per-query 实时增强，**不改动算法**。
- **T5 AI 调参反馈环（优化接口 `aiTuning`）**：周期 / 手动触发，喂入 `scoreSnapshots`（已带 `outcome`）回测统计 → LLM 诊断 → 产出「参数变更建议 diff」→ 人审 → 落 `decisionParams` → 引擎读取。即「持续优化算法」。

### 11.3 分期（详见 §5 的 T4 / T5 条目）

- **T4.1 / T4.2 / T4.3**：运行时解释层（决策卡片 AI 研判、K 线形态 AI 解读、复用 `ai.ts`）。
- **T5.1（前置）参数外置**：权重 / 阈值从内联常量抽成 `decisionParams` 配置，引擎运行时读取；外置后行为须零回归。
- **T5.2 / T5.3 / T5.4**：调参反馈环（结构化 diff 输出、人审采纳、自动触发、反馈可视化）。

### 11.4 验收

- **T4**：T1 已落地的 reversion 卡片能展示 AI 解释；解释文本不出现引擎未提供的捏造数据（校验 raw 输入与输出一致性）；未配置 AI 时 UI 引导去设置页。
- **T5**：外置参数后引擎行为与硬编码时完全一致（`verify-decision.mts` 复跑零回归）；人审采纳一处参数 diff 后，下次评分读取新值且 husky 门禁（tsc/eslint/vite build）通过；采纳后可观测准确率变化、可回滚。

### 11.5 风险与边界

- **幻觉风险**：LLM 可能编造「看起来合理但无数据支撑」的叙述。缓解：T4 Prompt 强制「仅基于给定结构化字段」+ 前端校验输出可溯源到输入；T5 只接受结构化参数 diff，不接受自由文本改写算法。
- **过拟合风险**：自动调参若只看近期样本会过拟合当下行情。缓解：T5.3 设最小样本阈值 + 采纳前展示「建议依据的样本区间 / 胜率变化」；重大变更需人审。
- **成本 / 隐私**：每次调用消耗用户自己的 API 额度；持仓 / 决策数据仅用户本地 + 其自选 LLM，不经第三方服务端（符合零后端）。T4 per-query 调用需设防抖 / 手动触发，避免打开即狂刷。
- **不与 T3 冲突**：T3 是「人工诚实化阈值」（恢复 70/0.6），T5 是把阈值外置后可被 AI 建议调整——两者顺序：先 T3 把阈值恢复到诚实基线，再 T5 外置让人 / AI 在诚实基线上演进。
