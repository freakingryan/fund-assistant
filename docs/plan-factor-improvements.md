# 评分引擎因子增强与预测力提升 — 实施计划

> 目标：提升基金评分决策引擎的**真实预测力**，并**解决净值基金评分被一刀切压缩、给不出高分/买入**的问题。
> 范围：纯前端。**新增前提**：东财(eastmoney) 经 Cloudflare Worker 代理接入视为可用（资金面/板块/同类排名等交叉截面因子）；**硬约束**：Worker 不可用 / 取数失败 / 未配置 → 因子必须**透明失效、不影响评分**（`available:false` → 不参与融合、不拉低分数）。基础工作流 A/B/C + 东财增强工作流 D 可独立交付。

---

## 0. 现状与架构结论（已核对代码）

| 项               | 结论                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 评分维度权重     | `decisionEngine.ts:32` `CAT_WEIGHT` 硬编码拍脑袋：`trend30 / bias20 / momentum15 / volume15 / macd10 / pattern10`                                                                                                                                                  |
| 净值压缩         | `decisionEngine.ts:247` 一刀切 `score = 50 + (score-50)*0.7`；压缩后上限 85、净值基金普遍压到 35-60                                                                                                                                                                |
| 净值模式可用因子 | `stockSdkIndicators.ts` 仅算 `BIAS / ROC`（`NAV_INDICATORS`），**浪费了 NAV 序列可算的动量/波动/回撤**                                                                                                                                                             |
| 关键事实         | 净值基金**已有 NAV 收盘价序列**（`buildDecision` 收到的 `klines` 即 NAV），可零新源算动量/波动/回撤                                                                                                                                                                |
| 交叉截面因子现状 | `capitalFlowAnalysis` / `sectorStrengthAnalysis` / 同类排名 **均门控东财(eastmoney)**。现状网络屏蔽 → 直接返回 `null`；**新方案：经 Cloudflare Worker 代理接入后可用**，且严格 graceful degradation（取数失败/未配置 → `available:false`，不进入融合、不影响评分） |
| 已具备基础设施   | `stats.ts` 的 `bySource` 拆分、回填自愈(reconcile)、AI 分析 prompt 已能按数据源/市场方向诊断                                                                                                                                                                       |

---

## 0.1 硬约束：所有「条件可用」外部因子必须 graceful degradation

用户明确：**东财可经 Worker 接入，但不可用时绝不影响评分**。据此约束推广到任何外部/条件因子（东财资金面/板块/同类排名、未来任何第三方源）：

- 每个条件因子返回结构带 `available: boolean`；取数失败 / 超时 / 未配置 / 解析错误 → `available:false`，**不抛异常**。
- 融合时**仅 `available` 的因子计入**；不可用时其贡献恒为 0，基础评分与「纯本地、未接入」完全一致（可脚本断言差值为 0）。
- 采用**叠加层(overlay)模型**而非重标定：条件因子作为「有界增量」附加在基础分之上，缺省 0，不重算 `CAT_WEIGHT`、不改变基础分尺度。
- 东财接入开关 = `settings.eastmoneyWorkerUrl`（默认空=禁用，自动等价于纯本地方案）。

---

## 工作流 A：NAV 原生因子（直接解决净值基金高分/买入问题）⭐推荐先做

### 动机

净值基金有 NAV 序列却只用 BIAS/ROC，强因子（动量/波动/回撤）被浪费；再叠加 `×0.7` 压缩 → 永远偏 sell/hold。补上 NAV 因子并软化压缩，净值基金即可按自身趋势给合理评级、甚至买入。

### 新增文件 `src/services/decision/navFactors.ts`

```ts
import type { KLineData } from "@/types";

export interface NavFactors {
  available: boolean;
  /** 各窗口 NAV 收益率(%)；窗口样本不足为 null */
  momentum20: number | null;
  momentum60: number | null;
  momentum120: number | null;
  /** 年化波动率(%) */
  volatilityAnnual: number | null;
  /** 区间最大回撤(%)，负值表示回撤 */
  maxDrawdown: number | null;
  /** 收益风险比 = 日均收益 / 日收益标准差 */
  returnRisk: number | null;
}

/** 从 NAV 收盘价序列计算动量/波动/回撤（纯本地，零网络）。
 *  窗口按可用长度自适应：momentum120 需 ≥120 根，否则取 null。 */
export function computeNavFactors(klines: KLineData[]): NavFactors;
```

### 改动 `src/services/decision/decisionEngine.ts`

1. `SignalCategory`（`decision/types.ts:17`）扩展：`| 'navmom'`。
2. `CAT_WEIGHT` 增加 `navmom: 12`（`TOTAL_WEIGHT` 自动求和，无需手改）。
3. `DecisionInputs`（`decision/types.ts:83`）增加 `nav?: NavFactors`。
4. 新增 `collectNavSignals(nav: NavFactors): AnalysisSignal[]`：
   - 动量：`momentum60 > +8` → bull，强度 `clamp(|mom60|/15, 0.2, 1)`；`< -8` → bear；`[-8,8]` 跳过。
   - 回撤修复：若 `maxDrawdown < -20` 且收盘价距区间高点 ≤5% → bull（均值回归）；若处于深跌且贴近低点 → bear。
   - 高波动（`volatilityAnnual > 35`）→ 给信号降 `confidence`（×0.8），不过度反应。
5. 软化压缩（`decisionEngine.ts:246-247`）：
   ```ts
   const navBasis = nav && nav.available;
   const compFactor = isLowConf ? (navBasis ? 0.9 : 0.7) : 1;
   if (isLowConf) score = Math.round(50 + (score - 50) * compFactor);
   ```
6. `signals` 数组追加 `...(nav ? collectNavSignals(nav) : [])`。

### 改动调用点

- `src/components/holdings/DecisionAdvisorCard.tsx:50`：当 `!isRealKline` 时 `computeNavFactors(klines)` 传入。
- `src/services/backtest/decisionSnapshot.ts:136 & :242`：同理，NAV 模式计算并传入 `nav`。

### 验收

- 单元自检：`computeNavFactors` 对一串示例 NAV 收盘价返回合理动量/波动/回撤。
- 打开 App：选一只无 ETF 映射的净值基金（如样本里的财通集成电路产业股票C），其评分应可突破 60、且理由里出现"NAV 60日动量"条目。
- 回测 reconcile 后：`bySource` 的"基金净值 K线"组方向性样本数上升、可现 hold/买入建议；`buyTotal` 不再恒为 0（与已放宽的买入阈值叠加生效）。

---

## 工作流 B：权重数据驱动重标定（用回测证据替代拍脑袋）

### 动机

`CAT_WEIGHT` 是主观值。用已积累的回测快照反推**每类真实方向性命中率**，据此重算权重，让"真正能预测"的因子权重更高。

### 改动 `src/services/backtest/types.ts`（ScoreSnapshot, :68）

新增 `categoryScores?: Partial<Record<SignalCategory, number>>` —— 记录该快照各维度的带符号有效功率（来自 `buildDecision` 的 `axisNet`）。

### 改动 `src/services/decision/decisionEngine.ts`

- `Decision` 增加 `axisScores: Record<SignalCategory, number>`（即融合循环里的 `axisNet` 直接外抛）。

### 改动 `src/services/backtest/decisionSnapshot.ts`

- 捕获 `decision.axisScores` 写入快照 `categoryScores`。

### 新增 `src/services/backtest/stats.ts` 函数

```ts
export interface CategoryAccuracy {
  category: SignalCategory;
  total: number; // 该类别有信号且快照已结算方向性的样本数
  correct: number; // 类别符号方向与 nextChangePct 符号一致的样本数
  accuracy: number | null;
}
export function computeCategoryAccuracy(snapshots: ScoreSnapshot[]): CategoryAccuracy[];
```

判定口径：对 `outcome ∈ {correct,wrong}` 的快照，类别 `c` 的"方向正确" = `sign(axisScores[c]) === sign(nextChangePct)`。

### 重标定（落地方式二选一）

- **(b1) 离线建议**：新增 `src/services/decision/calibrateWeights.ts` 导出 `suggestWeights(snapshots)`，用 `softmax(accuracy)` 生成建议 `CAT_WEIGHT` 并打印/存 settings，人工确认后改 `CAT_WEIGHT` 常量。
- **(b2) 运行时可配置**：把 `CAT_WEIGHT` 移到 `settings`（Zustand），默认用当前值，AI 分析产出建议权重可一键应用。

### 验收

- `computeCategoryAccuracy` 输出 6+1 类各自命中率；明显偏低（如 `pattern`）的权重被下调。
- 用历史快照做 holdout 复算：重标定后 `directionalAccuracy` 不低于原值（不掉点），且 `bySource` 两组的区分度提升。

---

## 工作流 C：市场 regime 因子（根治 beta 伪信号）

### 动机

当前 64.9% 准确率里大量来自"大盘跌→卖出全对"。引入**市场级状态**（沪深300ETF 动量/MA 排列），把个基信号与大盘 beta 分离，使回测命中率更能反映真择时力。

### 新增文件 `src/services/decision/regimeFactor.ts`

```ts
import type { Direction } from "./types";
export interface MarketRegime {
  trend: Direction; // bull / bear / neutral
  strength: number; // 0~1
  momentum60: number | null; // 沪深300 近60日收益(%)
  maBull: boolean; // MA20 > MA60
}
/** 取沪深300ETF(510300) K 线 → 算市场状态；取数失败返回 neutral。 */
export async function computeMarketRegime(): Promise<MarketRegime>;
```

### 改动 `src/services/decision/decisionEngine.ts`

1. `DecisionInputs` 增加 `regime?: MarketRegime`。
2. 融合循环后加 regime 调节：
   ```ts
   if (regime && regime.trend !== "neutral") {
     const disc = regime.strength * 0.5;
     // 空头市：对多头信号打折（避免把"大盘跌所以卖出对"记成个基 alpha）
     if (regime.trend === "bear") bullPower *= 1 - disc;
     else bearPower *= 1 - disc;
   }
   ```

### 改动 `src/services/backtest/types.ts`（ScoreSnapshot）

- 新增 `regimeMomentum60?: number | null`（快照时刻的大盘动量，用于事后算 alpha）。

### 改动 `src/services/backtest/decisionSnapshot.ts`

- 计算并写入 `regimeMomentum60`；`stats.ts` 可增 `adjustedNextChangePct = nextChangePct - regimeMomentum60` 作为"剔除 beta 后的真实收益"，用于 alpha 口径的准确率（可选增强）。

### 验收

- `computeMarketRegime` 在震荡/下跌市返回 `bear`、上涨市返回 `bull`；取数失败不崩（neutral 兜底）。
- 回测 `daily` 序列：加入 regime 折扣后，`accuracy` 与 `avgNextChange` 的**严格反相关减弱**（说明伪信号被剥离）。
- `bySource` 中"场内 ETF K线"组在剥离 beta 后仍能保持正 alpha，验证 ETF 因子本身有效。

---

## 工作流 D：东财交叉截面因子（经 Worker 接入，强制 graceful degradation）⭐新增

### 动机与前提

- 资金面(`capitalFlowAnalysis`)、板块强度(`sectorStrengthAnalysis`)、同类排名是**提升区分度最有价值**的交叉截面因子，但都门控东财。
- 用户确认：**东财经 Cloudflare Worker 代理接入后视为可用**；但**硬约束**——Worker 未部署 / URL 未配置 / 取数超时或失败 → 这些因子必须**透明失效**（不参与打分、不拉低评分）。
- 设计原则：**叠加层(overlay)模型**（见 §0.1），非重标定。东财因子作为「仅在 available 时生效的有界增量」，缺省为 0，绝不影响基础评分。

### 新增 `src/services/datasource/eastmoneyWorker.ts`（适配器）

```ts
export interface EmWorkerConfig {
  baseUrl: string; // Worker 地址，来自 settings.eastmoneyWorkerUrl；空串=禁用
  timeoutMs: number; // 建议 4000
}
/** 经 Worker 取东财数据；任何失败(网络/超时/非200/解析错) → 返回 null（不抛）。 */
export async function fetchViaWorker<T>(path: string, cfg: EmWorkerConfig): Promise<T | null>;
```

### 新增 `src/services/decision/eastmoneyFactors.ts`

```ts
import type { Direction } from "./types";
export interface EmFactors {
  capitalFlow: { available: boolean; netInflow20d?: number /* % */; trend: Direction };
  sector: { available: boolean; strength: number | null /* -1~1 */ };
  peerRank: { available: boolean; percentile: number | null /* 0~100, 越高越好 */ };
}
/** 并行取三类东财因子；任一失败 → 该项 available:false；全失败 → 整体不影响评分。 */
export async function collectEastmoneyFactors(
  fundCode: string,
  cfg: EmWorkerConfig,
): Promise<EmFactors>;
```

### 引擎融合（叠加层，graceful degradation 核心）

在 `buildDecision` 基础分算出后，叠加东财增量：

```ts
// 仅 available 的因子产生有界增量（每类 ±5，合计上限 ±12）
let emDelta = 0;
if (em.capitalFlow.available)
  emDelta += clamp(
    em.capitalFlow.trend === "bull" ? 5 : em.capitalFlow.trend === "bear" ? -5 : 0,
    -5,
    5,
  );
if (em.sector.available && em.sector.strength != null)
  emDelta += clamp(em.sector.strength * 8, -5, 5);
if (em.peerRank.available && em.peerRank.percentile != null)
  emDelta += clamp((em.peerRank.percentile - 50) / 10, -5, 5);
emDelta = clamp(emDelta, -12, 12);
score = clamp(Math.round(score + emDelta), 0, 100);
```

- `available:false` → 增量恒为 0 → **评分与「未接入东财」完全一致**，满足硬约束。
- 取数失败/未配置 → `collectEastmoneyFactors` 返回全 `available:false` → `emDelta = 0`。

### 改动 `src/services/decision/decisionEngine.ts`

1. `DecisionInputs` 增加 `em?: EmFactors`。
2. `buildDecision` 增加上述叠加逻辑；`em` 缺省视为全 `available:false`。
3. `SignalCategory` 增加 `'capitalflow' | 'sector' | 'peer'` 仅用于**解释文案 / 回测归因**（不参与 `CAT_WEIGHT` 基础权重）。

### 改动调用点

- `DecisionAdvisorCard` / `decisionSnapshot`：异步获取 `em` → 传入 `buildDecision`；取数失败静默降级。
- `settings` 增加 `eastmoneyWorkerUrl` 字段（默认空=禁用，自动走纯本地因子）。

### 验收

- **降级验证（最关键）**：清空 `eastmoneyWorkerUrl` 配置 → 评分与「改造前纯本地」完全一致（可脚本断言差值=0）。
- **可用验证**：配置 Worker URL、模拟返回净流出+板块弱 → 相关基金评分下调、理由出现「资金面净流出」；同类排名前 10% → 评分上调。
- 单元自检：`collectEastmoneyFactors` 在 fetch 抛错/超时时返回全 `available:false`，不抛异常。

### 附录：Cloudflare Worker 部署（不在主流程内）

- `wrangler init` 脚手架；Worker 代码 `fetch(eastmoneyUrl)` 并透传 JSON（仅代理、不缓存/不改动数据）。
- 前端 `settings.eastmoneyWorkerUrl` 填 Worker `*.workers.dev` 地址即可启用 D；未部署时整套方案自动等价于「仅 A/B/C」。

---

## 验证与回归（通用）

1. **类型基线**：本项目 baseline 本就存在 26 个无关 `tsc -b` 错误（circuitBreaker/ImportDialog/PlansPage/fundCodeRepair 等），与本次任务无关；对比 stash 前后确认**未新增 tsc 错误**。
2. **构建**：`NODE_OPTIONS="" npx vite build` 必须成功（esbuild 类型剥离，真实构建路径）。
3. **Lint**：`NODE_OPTIONS="" npx eslint` 仅针对改动文件，0 error。
4. **功能**：
   - 工作流 A：示例 NAV 序列→因子合理；无 ETF 基金评分可破 60、理由含 NAV 动量。
   - 工作流 B：类别命中率表输出；重标定后 holdout 不掉点。
   - 工作流 C：regime 识别正确；daily 反相关减弱。
   - 工作流 D：降级断言（无 Worker 配置 → 评分与纯本地一致、差值为 0）；配置 Worker → 资金面/板块/同类排名产生有界增量且理由可见。
5. **AI 分析同步**：`aiAnalysis.ts` prompt 增加第 9 条——要求 AI 在诊断时一并解读 NAV 因子贡献与 regime 折扣后的 alpha，避免再误读 beta 为择时力。

---

## 风险与前提

- **NAV 序列长度**：动量窗口依赖 K 线长度。腾讯 `proxy.finance.qq.com` 的 fqkline 通常返回数百根日线，足够 20/60/120 日；若某基金历史短，`momentum120` 为 null，代码需优雅降级（已设计）。
- **regime 取数**：依赖 ETF K 线（510300）走腾讯端点（已修复可用），失败回 neutral，不影响主流程。
- **东财经 Worker 接入 + graceful degradation（硬约束）**：资金面/板块/同类排名经 Cloudflare Worker 代理获取；**任何失败（未配置 URL / 超时 / 非200 / 解析错）→ 因子 `available:false`、增量恒为 0，评分与纯本地完全一致**。Worker 部署步骤（wrangler 脚手架 + 代理东财域名）单列在附录，不在本计划主流程；未部署时整套方案自动等价于「仅 A/B/C」。
- **Worker 仅代理、不缓存/不改动数据**；若东财侧结构变化导致解析失败，同样走 `available:false` 降级，不污染评分。
- **权重变更影响面**：`CAT_WEIGHT` 改动会影响所有基金评分，需回测对照，建议先 B 的离线建议(b1)观察再落常量。

---

## 推荐实施顺序

1. **A（NAV 原生因子）** —— 直接解决你问的"净值基金给不出高分/买入"，最小改动、零风险、纯本地。
2. **C（regime 因子）** —— 根治 beta 伪信号，让后续所有准确率数字可信；依赖腾讯端点(已修复)。
3. **D（东财交叉截面因子 via Worker）** —— 在 A+C 之上叠加资金面/板块/同类排名；**含 graceful degradation**，Worker 未部署时透明失效、不影响评分。
4. **B（权重重标定）** —— 在 A+C+D 已让数据干净、因子更全后，用回测证据做最后精细化。

> 跨工作流硬约束：**所有「条件可用」因子（D 的东财、及未来任何外部源）必须实现 graceful degradation**——缺失即 `available:false`、增量 0、评分不变。这是用户明确要求的底线。
>
> 注：以上为计划文档，未改动任何代码。确认范围后我按 A → C → D → B 顺序落地，每步跑 tsc/vite build/eslint 验证，按协作约定不自动 push。
