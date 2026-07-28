# PLAN — 智能决策引擎算法优化

> 状态：Proposed（2026-07-29）
> 关联：`PENDING_PLAN.md` §一 新增条目「决策引擎算法优化」
> 验证脚本：仓库根 `verify-decision.mts`（Node 直跑真实引擎，无需浏览器）

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

- **T2.1** 波动 / 仓位建议：新增 `computeHistoricalVol(klines)` → 输出「建议仓位 / 止损参考」只读字段（即便不改动作也实用）。
- **T2.2** 去重：若 capital/sector 已作为硬门控参与，移除现有 `em` 的 ±12 重复软叠加，避免双重计数。

### T3 — 校准卫生

- **T3.1** 诚实化买入阈值：恢复 `score>=70 && bullRatio>=0.6` 给「趋势买入」；另设 `reversion` 路径阈值（如 `score>=75 && 中期下行`）并强制免责声明，不再为回测覆盖而放宽。
- **T3.2** 联接基金跟踪误差折扣：用 NAV 序列 vs ETF 收益算 `trackingError`，对置信度打折（需额外取 NAV 序列，`isRealKline` 时已有）。

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
- **双重计数风险**：T2.2 处理 `em` 与硬门控的重叠。
- **资金流为 T 日快照**：对「背离」判定够用，但非实时；北向/资金流仅东财增强开启时可用。

## 9. 推荐落地顺序（MVP）

先做 **T1（T1.1–T1.5）**，用 `verify-decision.mts` 验证 159157/159147 由「买入」转为「反弹 / 观察」，再视效果推进 T2 / T3。
