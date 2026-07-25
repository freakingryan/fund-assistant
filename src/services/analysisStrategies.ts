/**
 * 声明式分析策略库（移植自 daily_stock_analysis 的 15 个 YAML 策略）。
 *
 * 设计原则：
 * - 纯数据 + 类型，零运行时接口依赖（符合「优先用 stock-api/stock-sdk、不自维护接口逻辑」）。
 * - instructions 原样保留 DSA 的中文分析框架（仅去掉工具名周围的 markdown 反引号以便 TS 字符串存储）。
 * - requiredData 把 DSA 的 required_tools 映射到 fund-assistant 已有数据视角，仅作 UI 提示。
 * - 作为「加性透镜」追加到既有 base prompt，不修改 base 文本（回归安全）。
 */

export type StrategyCategory = "trend" | "pattern" | "reversal" | "framework";
export type StrategyRequiredData = "kline" | "holdings" | "sector" | "news";

export interface AnalysisStrategy {
  /** 唯一标识（对应 DSA 的 name） */
  id: string;
  displayName: string;
  description: string;
  category: StrategyCategory;
  /** 关联核心交易理念编号（1-7） */
  coreRules?: number[];
  /** 该策略依赖的数据视角（仅作 UI 提示，不影响生成） */
  requiredData: StrategyRequiredData[];
  aliases?: string[];
  defaultPriority: number;
  marketRegimes?: string[];
  /** 自然语言分析框架（核心透镜） */
  instructions: string;
  /** 评分调整建议段落 */
  scoreAdjust?: string;
}

export const STRATEGY_CATEGORY_LABELS: Record<StrategyCategory, string> = {
  trend: "趋势",
  pattern: "形态",
  reversal: "反转",
  framework: "框架",
};

export const STRATEGY_DATA_LABELS: Record<StrategyRequiredData, string> = {
  kline: "场内 ETF K线",
  holdings: "基金持仓/重仓股",
  sector: "板块强弱",
  news: "新闻舆情",
};

export const ANALYSIS_STRATEGIES: AnalysisStrategy[] = [
  {
    id: "hot_theme",
    displayName: "热点题材",
    description: "跟踪政策、产业和市场热点，判断题材强度、板块扩散和个股相对强弱。",
    category: "framework",
    coreRules: [2, 3, 5, 7],
    requiredData: ["sector", "news", "kline"],
    aliases: ["热点", "题材", "热点题材"],
    defaultPriority: 35,
    marketRegimes: ["sector_hot"],
    instructions: `热点题材策略（Hot Theme Strategy）

适用场景：
- 市场出现明确政策、产业、技术路线或资金抱团热点。
- 需要判断标的（基金对应场内 ETF 或其重仓股）是否真正受益于热点，而不是单纯蹭概念。

分析框架：

1. 热点强度
   - 判断相关板块是否在近期涨幅、成交额或人气上处于前列。
   - 观察热点是否从少数核心标的扩散到板块内多只标的。
   - 若只有单标异动、板块未共振，降低信号权重。

2. 标的与热点相关性
   - 检查公司业务、订单、产能、客户、公告是否与热点直接相关。
   - 区分“实质受益”“间接受益”“概念关联较弱”。
   - 概念关联弱但涨幅过大时，应提示题材兑现风险。

3. 相对强弱
   - 判断标的涨幅、量比、换手率是否强于板块平均。
   - 强势热点标的通常表现为放量、换手活跃、回调不破关键均线。

4. 节奏与风险
   - 不在连续加速、高乖离率位置追涨。
   - 若新闻集中在“已经大涨”“资金追捧”“龙虎榜游资博弈”，需要警惕短线情绪顶。
   - 重大利空、监管问询、澄清公告可一票降低评级。

输出要求：
- 明确当前热点阶段：启动 / 扩散 / 分化 / 退潮。
- 说明标的与热点的实质相关性。
- 给出可执行触发条件：回踩承接、放量突破、板块继续共振或退潮止损。`,
    scoreAdjust: `- 热点处于启动或扩散期，且标的实质受益：+12
- 标的强于板块并有量能确认：额外 +6
- 热点进入分化或退潮：-8
- 仅概念蹭热点且乖离率过高：-12`,
  },
  {
    id: "growth_quality",
    displayName: "成长质量",
    description: "结合收入利润增长、ROE、现金流和行业空间，识别高质量成长与成长失速风险。",
    category: "framework",
    coreRules: [2, 3, 5],
    requiredData: ["holdings", "news", "kline"],
    aliases: ["成长", "成长股", "成长质量"],
    defaultPriority: 55,
    marketRegimes: ["trending_up"],
    instructions: `成长质量策略（Growth Quality Strategy）

适用场景：
- 关注公司中长期成长能力，而不是只看短线技术形态。
- 适合高景气行业、业绩持续改善或商业模式扩张阶段的公司。

分析框架：

1. 成长性
   - 优先查看营收、归母净利润、经营现金流和 ROE。
   - 判断收入增长和利润增长是否同向，是否存在“增收不增利”。
   - 若只有概念热度但财报尚未验证，应降低成长确定性。

2. 质量
   - ROE 越高且稳定，质量越好。
   - 经营现金流与净利润方向一致，说明盈利质量更可靠。
   - 现金流显著弱于利润时，要提示回款、存货或应收风险。

3. 估值承受力
   - 使用 PE/PB、市值等估值字段判断市场是否已经提前透支成长。
   - 高成长可承受更高估值，但必须说明增长能否覆盖估值。
   - 估值高且成长放缓时，应明显下调评分。

4. 趋势确认
   - 判断长期成长逻辑是否被市场资金确认。
   - 基本面向好但技术面未确认时，优先给观察条件而不是直接追买。

输出要求：
- 明确公司处于：高质量成长 / 成长验证中 / 成长放缓 / 成长证伪。
- 说明成长来自收入扩张、利润率改善、行业景气，还是一次性因素。
- 给出适合成长股的买点：业绩验证后突破、回踩长期均线或估值回落。`,
    scoreAdjust: `- 收入、利润、现金流和 ROE 同向改善：+15
- 行业景气与公司新闻互相验证：额外 +6
- 高估值但成长未验证：-8
- 增收不增利或现金流恶化：-12`,
  },
  {
    id: "ma_golden_cross",
    displayName: "均线金叉",
    description: "检测均线金叉配合量能确认信号，经典的趋势反转/延续信号。",
    category: "trend",
    coreRules: [1, 2, 3],
    requiredData: ["kline"],
    aliases: ["均线金叉", "金叉"],
    defaultPriority: 20,
    marketRegimes: ["trending_up"],
    instructions: `均线金叉（MA Golden Cross Strategy）

信号判定标准：

1. 金叉检测
   - 检查均线排列和 MACD 状态。
   - 主信号：MA5 在最近 3 个交易日内上穿 MA10。
   - 强信号：MA10 上穿 MA20（更慢但更可靠）。
   - 检查 MACD 状态是否为金叉或零轴上方金叉。

2. 量能确认
   - 金叉日成交量应高于 5 日均量。
   - 金叉日量比 > 1.2 为积极信号。

3. 趋势背景
   - 盘整后金叉：最强信号。
   - 上升趋势中金叉：延续信号。
   - 深度下跌中金叉：弱信号，需更多确认。

4. 价格位置
   - 价格应在交叉均线附近或上方。
   - 乖离率 < 5% — 避免追高延迟入场。

评分调整：
- MA5 × MA10 金叉配合量能：+10
- MA10 × MA20 金叉：+8
- MACD 零轴上方金叉：额外 +5
- 理想买点设在交叉均线水平附近。`,
    scoreAdjust: `- MA5 × MA10 金叉配合量能：+10
- MA10 × MA20 金叉：+8
- MACD 零轴上方金叉：额外 +5`,
  },
  {
    id: "bull_trend",
    displayName: "默认多头趋势",
    description: "默认分析优先策略，识别多头排列、趋势延续与回踩低吸机会。",
    category: "trend",
    coreRules: [1, 2, 3],
    requiredData: ["kline"],
    aliases: ["趋势", "趋势分析", "多头趋势"],
    defaultPriority: 10,
    marketRegimes: ["trending_up"],
    instructions: `默认多头趋势（Default Bull Trend Strategy）

适用场景：
- 常规标的分析的默认策略。
- 优先寻找“趋势向上 + 风险可控 + 不追高”的机会。

分析框架：

1. 趋势确认（优先级最高）
   - 判断 MA5/MA10/MA20 排列。
   - MA5 >= MA10 >= MA20 且 MA20 斜率向上，视为多头结构。
   - 若价格显著跌破 MA20，则降低看多权重。

2. 位置与节奏
   - 优先“回踩不破”而非“高位追涨”。
   - 当价格距离 MA5/MA10 过远时，提示等待回踩。
   - 放量突破有效阻力时可提高胜率评级。

3. 量价验证
   - 检查突破日/反弹日是否放量。
   - 缩量上涨需谨慎，放量滞涨需警惕分歧。

4. 交易建议输出
   - 输出明确的“买入/观望/减仓”倾向及触发条件。
   - 必须给出止损参考（如 MA20 下方或结构低点）。
   - 若无清晰优势，明确写“暂不出手”，避免过度交易。`,
    scoreAdjust: `- 多头排列 + 趋势强度良好：+12
- 回踩关键均线后企稳：+8
- 放量突破关键阻力：+10
- 跌破 MA20 或趋势转弱：-12`,
  },
  {
    id: "chan_theory",
    displayName: "缠论",
    description: "基于缠论笔、线段、中枢结构，判断趋势级别、买卖点与背驰信号。",
    category: "framework",
    coreRules: [1, 2, 3, 4],
    requiredData: ["kline"],
    aliases: ["缠论", "缠论分析"],
    defaultPriority: 70,
    marketRegimes: ["volatile"],
    instructions: `缠论（Chan Theory / Zen Channel Theory）

核心框架：分型 → 笔 → 线段 → 中枢 → 趋势

分析步骤：

1. 判断价格结构（中枢识别）
   - 获取近 60 日日线数据。
   - 识别近期价格的高低点序列，判断当前是在震荡中枢（1 个以上中枢）还是趋势段（脱离中枢向上/向下）。
   - 中枢：连续 3 段走势重叠区间，价格在此区间反复震荡。
   - 趋势：连续 3 个同级别中枢均向同一方向移动。

2. 背驰判断（最高优先级信号）
   - 顶背驰：价格创新高但 MACD 红柱面积缩小 → 卖出/减仓信号。
   - 底背驰：价格创新低但 MACD 绿柱面积缩小 → 买入/加仓信号。
   - 获取 MACD 数据，与价格高低点对比。

3. 买卖点判定
   - 一买（最强）：下跌趋势中，最后一个中枢出现底背驰。
   - 二买：离开下跌中枢后的第一次回调不破中枢高点。
   - 三买：中枢震荡后向上突破（不回中枢内）。
   - 一卖/二卖/三卖：对称结构，方向相反。
   - 当前价格所处的买卖点级别决定仓位大小。

4. 级别与仓位
   - 日线级别买卖点可用较重仓位（30-50%）。
   - 周线级别买卖点可用较大仓位（50-80%）。
   - 多级别共振（日线+周线同方向）时信号最强。

5. 输出要求
   - 明确说明当前处于：上涨趋势/下跌趋势/中枢震荡。
   - 指出是否存在背驰信号及背驰级别。
   - 给出当前买卖点类型（一买/二买/三买等），若无则写“暂无明确买卖点”。
   - 止损设于前低（买入时）或前高（卖出时）。`,
    scoreAdjust: `- 底背驰 + 一买信号：+15
- 二买/三买共振：+10
- 中枢震荡无明确方向：维持基准
- 顶背驰 / 趋势向下：-15`,
  },
  {
    id: "wave_theory",
    displayName: "波浪理论",
    description: "基于艾略特波浪理论的推动浪与调整浪结构，判断当前所处浪型与潜在目标价。",
    category: "framework",
    coreRules: [1, 2, 3, 4],
    requiredData: ["kline"],
    aliases: ["波浪", "波浪理论", "艾略特"],
    defaultPriority: 80,
    marketRegimes: ["volatile"],
    instructions: `波浪理论（Elliott Wave Theory）

核心原则：市场按照 5 浪推进 + 3 浪调整的循环结构运行。

分析步骤：

1. 识别当前浪型（近 120 日数据）：
   推动浪（1-3-5）识别特征：
   - 第 1 浪：趋势反转的第一波，成交量温和放大。
   - 第 3 浪：最强劲的推动浪，通常放大量，MACD 强势；绝不是最短浪。
   - 第 5 浪：量能往往弱于第 3 浪，出现顶背离则走高后即将结束。
   调整浪（A-B-C）识别特征：
   - A 浪：第一次下跌，成交量较大，多数人以为是回调。
   - B 浪：反弹，力度弱于前期涨幅，成交量萎缩，陷阱风险高。
   - C 浪：第二次下跌，力度往往超过 A 浪，完成调整。

2. 黄金位置判断
   - 第 2 浪回调通常在第 1 浪的 38.2%~61.8%。
   - 第 3 浪目标通常是第 1 浪的 1.618~2.618 倍延伸。
   - 第 4 浪不得进入第 1 浪价格区域。
   - C 浪目标：A 浪顶端起算，等于或超过 A 浪长度。

3. 最优买点
   - 第 2 浪回调企稳（黄金坑）：最安全买点，止损第 1 浪起点。
   - 第 4 浪回调企稳：次优，止损第 1 浪顶部。
   - 第 3 浪初期突破：放量突破第 1 浪高点时。
   - 避免在第 5 浪末端追高（顶背离风险）。

4. 风险提示
   - B 浪反弹不宜重仓（陷阱性质）。
   - 波浪计数存在主观性，需结合其他技术指标验证。
   - 若波浪规则被违反（如第 4 浪侵入第 1 浪），需重新归数。

5. 输出要求
   - 给出当前可能的浪型位置（如：“处于第 3 浪中段”或“疑似第 4 浪调整”）。
   - 给出关键斐波那契支撑/阻力位（0.382/0.618/1.618）。
   - 说明当前是买入时机、等待机会还是规避。
   - 标注波浪计数的置信度（高/中/低）。`,
    scoreAdjust: `- 第 2 浪底部企稳（黄金坑）：+15
- 第 3 浪突破确认：+12
- 第 5 浪末端/顶背离：-10
- C 浪下跌中：-12`,
  },
  {
    id: "dragon_head",
    displayName: "龙头策略",
    description: "板块轮动中识别龙头标的。适用于板块启动或行业催化剂出现时。",
    category: "trend",
    coreRules: [2, 7],
    requiredData: ["sector", "news", "kline"],
    aliases: ["龙头", "龙头战法"],
    defaultPriority: 90,
    marketRegimes: ["sector_hot"],
    instructions: `龙头策略（Dragon Head Strategy）

评估标准：

1. 板块领涨地位
   - 检查该标的所在板块是否为近期涨幅前列。
   - 确认该标的是否在板块启动周期中率先上涨或涨停。

2. 换手率与动能
   - 检查换手率。龙头标的换手率通常 > 5%。
   - 量比 > 1.5 说明有活跃的交易兴趣。

3. 相对强度
   - 对比标的涨跌幅与板块平均值。
   - 真正的龙头在上涨日应跑赢板块 2% 以上。

4. 新闻催化
   - 搜索板块级催化剂（政策、事件、业绩）。
   - 龙头行情常伴随板块整体催化。

5. 乖离率检查
   - 龙头标的可适当放宽乖离率至 7%，但超过 10% 仍需谨慎。`,
    scoreAdjust: `- 确认为龙头标的：+10
- 板块正处于主动轮动期：额外 +5`,
  },
  {
    id: "emotion_cycle",
    displayName: "情绪周期",
    description:
      "基于市场情绪、换手率与量价结构，识别情绪低点（恐慌底）与情绪高点（狂热顶），逆情绪布局。",
    category: "framework",
    coreRules: [1, 2, 3, 5],
    requiredData: ["kline", "news"],
    aliases: ["情绪", "情绪周期"],
    defaultPriority: 100,
    marketRegimes: ["sector_hot"],
    instructions: `情绪周期策略（Sentiment Cycle Strategy）

核心哲学：市场参与者的情绪在“恐慌→悲观→怀疑→希望→乐观→兴奋→贪婪→狂热”之间循环。聪明钱在恐慌底部布局，在狂热顶部离场。

情绪阶段量化指标：

第一步：换手率分析（情绪热度核心指标）
- 换手率 < 0.5%/日：市场冷淡，无人关注，潜在底部区域。
- 换手率 0.5%~2%：正常交投，情绪平稳。
- 换手率 2%~5%：活跃，市场开始关注，不宜追高。
- 换手率 > 5%：高热度，游资/散户涌入，警惕情绪顶。
- 换手率 > 10%（日均）：极度过热，通常为短期顶部。

第二步：连续换手率走势（近 20 日）
- 由高向低（持续降温）+ 成交量萎缩 → 情绪退潮，耐心等待。
- 由低向高（加速升温）+ 成交量陡增 → 情绪启动，可介入。
- 突然单日暴量（换手率超过前期 5 倍）→ 往往是主力出货，需警惕。

第三步：新闻情绪面分析
- 新闻集中出现“利好兑现、业绩超预期、涨停板、机构推荐”等 → 情绪可能过热。
- 新闻集中出现“业绩下滑、利空、跌破支撑” → 悲观情绪可能造就底部。
- 散户论坛/社交媒体情绪极端负面 → 反向指标，可能接近底部。

第四步：均线收缩与波动率
- MA5/MA10/MA20 三线粘合（均线收缩）→ 蓄势，方向待定，情绪冷淡。
- 波动率降至低位（ATR 萎缩）→ 情绪极度低迷，蓄势爆发前兆。

情绪底部特征（买入区，满足 3 项以上）：
- 近 20 日换手率处于近一年低位
- 成交量持续萎缩，低于近 60 日均量 50% 以上
- 近期新闻以低调、中性或负面为主
- 股价在 MA20 附近或以下，但未出现恐慌性暴跌
- 机构持仓稳定或小幅增加

情绪顶部特征（减仓区，满足 3 项以上）：
- 近 5 日换手率 > 近 20 日均值的 2 倍
- 成交量脉冲式放大（单日）
- 新闻以利好兑现、机构目标价大幅上调、散户追捧为主
- 股价偏离 MA5 超过 8%（高乖离率）
- MACD 出现顶背离

输出要求：
- 当前情绪阶段判断：冷淡底部 / 平稳 / 升温介入 / 过热警惕 / 狂热顶部。
- 当前换手率与近一年换手率均值对比。
- 是否满足情绪底部或顶部特征（列出满足条项）。
- 给出逆情绪操作建议（大众恐慌我贪婪，大众贪婪我谨慎）。`,
    scoreAdjust: `- 情绪底部特征满足 3 项以上：+14
- 情绪底部特征满足全部 5 项：+20
- 情绪顶部特征满足 3 项以上：-12
- 情绪顶部特征满足全部 5 项：-20
- 情绪平稳区间：不调整基础分`,
  },
  {
    id: "event_driven",
    displayName: "事件驱动",
    description: "围绕业绩、政策、并购、订单、产品发布等事件，评估催化强度、兑现概率和风险边界。",
    category: "framework",
    coreRules: [3, 5],
    requiredData: ["news", "kline"],
    aliases: ["事件驱动", "催化", "催化事件"],
    defaultPriority: 45,
    marketRegimes: ["sector_hot", "volatile"],
    instructions: `事件驱动策略（Event Driven Strategy）

适用场景：
- 公司或行业出现明确事件催化，如业绩预告、订单中标、并购重组、政策落地、产品发布、监管处罚、诉讼等。
- 需要判断事件是短期交易催化、长期基本面改善，还是利好兑现。

分析框架：

1. 事件分类
   - 梳理近期关键事件。
   - 将事件分为：业绩类、政策类、订单/产品类、资本运作类、监管/风险类。
   - 明确事件发生时间，过期或时间未知的信息不能作为主要依据。

2. 影响路径
   - 判断事件影响的是收入、利润率、估值、融资能力、市场份额，还是仅影响情绪。
   - 对重大订单或政策利好，要说明兑现周期和不确定性。
   - 对监管、减持、处罚、诉讼等事件，风险优先。

3. 市场反应
   - 判断事件是否已被价格充分反映。
   - 放量上涨但未过关键阻力，可等待确认。
   - 高位放量滞涨或利好后冲高回落，应警惕兑现压力。

4. 交易计划
   - 事件未兑现前，强调仓位控制和时间窗口。
   - 事件兑现后，重新评估是否从“预期交易”切换为“业绩验证”。
   - 对负面事件，先看风险释放是否充分，再考虑反弹。

输出要求：
- 明确事件性质：利好 / 利空 / 中性 / 不确定。
- 给出事件可信度、兑现周期、已反映程度。
- 操作建议必须包含失效条件，如公告不及预期、跌破关键支撑或事件热度消退。`,
    scoreAdjust: `- 高可信正向事件且价格尚未充分反映：+14
- 正向事件已大幅兑现：-6
- 负面事件仍在发酵：-15
- 事件影响不清晰或信息冲突：维持中性并降低置信度`,
  },
  {
    id: "expectation_repricing",
    displayName: "预期重估",
    description: "分析业绩预期、政策预期和估值预期的变化，寻找预期差修复或预期过热后的回落风险。",
    category: "framework",
    coreRules: [3, 5, 6],
    requiredData: ["news", "holdings", "kline"],
    aliases: ["预期", "预期差", "预期重估"],
    defaultPriority: 65,
    marketRegimes: ["volatile", "sector_hot"],
    instructions: `预期重估策略（Expectation Repricing Strategy）

适用场景：
- 市场对公司业绩、政策、行业景气、估值中枢或竞争格局的预期正在变化。
- 需要判断当前价格反映的是“预期修复”“预期落空”还是“预期过热”。

分析框架：

1. 预期来源
   - 识别近期改变市场预期的信息：业绩预告、机构观点、订单、政策、产品进展、行业数据。
   - 区分硬信息（公告、财报、订单）和软信息（传闻、观点、情绪）。

2. 预期差方向
   - 正向预期差：市场原本悲观，新增信息显示业务或业绩好于预期。
   - 负向预期差：市场原本乐观，新增信息低于预期或验证失败。
   - 若信息已经被连续大涨充分反映，需要提示预期兑现风险。

3. 估值重估
   - 使用 PE/PB、市值、ROE、现金流等字段判断估值重估是否有基本面支撑。
   - 估值提升需要匹配盈利质量、增长持续性和行业空间。
   - 估值回落时，观察是否由一次性扰动还是长期逻辑变化导致。

4. 价格确认
   - 判断预期变化是否已经转化为趋势。
   - 放量突破可视为预期被资金确认；缩量反弹则更偏修复观察。
   - 高位放量滞涨、利好不涨或跌破关键支撑，可能意味着预期转弱。

输出要求：
- 明确当前是：正向预期差 / 预期兑现 / 负向预期差 / 预期不明。
- 说明哪些信息改变了市场预期，哪些仍待验证。
- 给出观察点：下一份财报、订单兑现、政策落地、估值回落或技术确认。`,
    scoreAdjust: `- 正向预期差且价格尚未充分反映：+15
- 正向预期差已被连续大涨兑现：-5
- 负向预期差或核心假设被证伪：-15
- 信息不充分但存在潜在修复：维持中性并降低置信度`,
  },
  {
    id: "box_oscillation",
    displayName: "箱体震荡",
    description: "识别价格箱体区间，在箱底买入、箱顶减仓，适用于横盘震荡行情。",
    category: "framework",
    coreRules: [1, 2, 3],
    requiredData: ["kline"],
    aliases: ["箱体", "箱体震荡"],
    defaultPriority: 50,
    marketRegimes: ["sideways"],
    instructions: `箱体震荡战法（Box Range Trading Strategy）

核心逻辑：箱体内部价格在阻力位与支撑位之间反复震荡，“贴着支撑买、接近阻力卖”，通过波段操作获取区间收益。

分析步骤：

1. 箱体识别（近 60~120 日数据）
   - 箱体顶部（阻力位）：近期多次触碰但未有效突破的高点连线，通常为 20~60 日内 3 次以上的高点聚集区域。
   - 箱体底部（支撑位）：近期多次下探但未有效跌破的低点连线。
   - 箱体有效性：顶部和底部各至少触碰 2~3 次方可确认。

2. 当前位置判断
   - 箱底区域（距支撑 ≤5%）：买入/加仓信号，止损设箱底下方 3%。
   - 箱中区域（箱体中间 1/3）：观望，不主动操作。
   - 箱顶区域（距阻力 ≤5%）：减仓/止盈信号，无需追高。

3. 量能辅助判断
   - 箱底放量企稳：支撑有效的强信号，可较重仓。
   - 箱顶缩量滞涨：阻力有效的卖出信号。
   - 箱体突破（放量超过均量 2 倍以上）：
     - 向上有效突破 → 转为多头趋势策略，新目标 = 箱体高度延伸。
     - 向下有效跌破 → 离场等待，原支撑转阻力。

4. 箱体宽度与预期收益
   - 宽度 < 5%：操作空间过小，不建议参与。
   - 宽度 5%~15%：标准箱体，波段操作可行。
   - 宽度 > 15%：大箱体，可做更大波段。

5. 假突破识别
   - 单日盘中触及阻力/支撑后快速回撤，收盘回到箱内 → 假突破，维持箱体操作。
   - 连续两日收盘突破箱体边界，且量能放大 → 真突破，修改策略。

6. 输出要求
   - 明确给出箱体顶部价位和底部价位。
   - 当前价格所处区间（箱底/箱中/箱顶）。
   - 若价格已突破，说明突破方向及新目标。
   - 建议仓位与止损位。`,
    scoreAdjust: `- 箱底企稳 + 缩量：+10
- 箱底放量攻顶：+12
- 箱体向上有效突破：+15（转趋势策略）
- 处于箱顶区域：-5（不追高）
- 箱底有效跌破：-15（离场）`,
  },
  {
    id: "bottom_volume",
    displayName: "底部放量",
    description: "检测长期下跌后底部放量信号，潜在趋势反转信号。",
    category: "reversal",
    coreRules: [2, 5],
    requiredData: ["kline", "news"],
    aliases: ["地量见底", "底部放量"],
    defaultPriority: 60,
    marketRegimes: ["trending_down"],
    instructions: `底部放量（Bottom Volume Surge Strategy）

反转判定标准：

1. 持续下跌确认
   - 股价从 20 日高点到近期低点跌幅 > 15%。
   - 趋势状态应为空头或强空头。

2. 量能异动
   - 当日成交量 > 5 日均量的 3 倍。
   - 该异动应出现在前期极度缩量之后。

3. 价格企稳
   - 当日 K 线收阳（收盘价 > 开盘价）。
   - 价格守住近期低点。
   - 最好出现长下影线，显示买方支撑。

4. 确认因素
   - 确认是否有基本面催化。
   - 筹码分布：平均成本接近现价（成本收敛）。

5. 风险提示
   - 这是反转信号，风险高于趋势跟踪。
   - 仓位建议较小（最多 2-3 成）。
   - 止损必须严格（设在近期低点下方）。`,
    scoreAdjust: `- 底部放量确认：+8
- 配合阳线 + 新闻催化：额外 +5
- 止损设在近期低点。`,
  },
  {
    id: "shrink_pullback",
    displayName: "缩量回踩",
    description: "检测缩量回踩均线支撑信号，趋势延续的理想入场点。",
    category: "trend",
    coreRules: [1, 2, 4],
    requiredData: ["kline", "news"],
    aliases: ["缩量回踩", "回踩"],
    defaultPriority: 40,
    marketRegimes: ["trending_down", "sideways"],
    instructions: `缩量回踩（Shrink Volume Pullback Strategy）

入场判定标准：

1. 前提条件
   - 标的必须处于上升趋势（MA5 > MA10 > MA20）。
   - 确认多头排列。

2. 回踩检测
   - 价格回踩至 MA5 附近（误差 1% 以内）或 MA10 附近（误差 2% 以内）。
   - 回调期间成交量 < 5 日均量的 70%（缩量特征）。

3. 反弹信号
   - 当前价格守住均线支撑位。
   - MA5 乖离率 < 2% — 最佳买入区间。

4. 确认条件
   - 无利空消息。
   - 筹码分布健康（获利比例 50-80%）。`,
    scoreAdjust: `- 缩量回踩 MA5：+10
- 缩量回踩 MA10 且量能 < 0.6 倍均量：+8
- 理想买点设在 MA5 水平，次优买点设在 MA10。
- 止损设在 MA20 水平。`,
  },
  {
    id: "volume_breakout",
    displayName: "放量突破",
    description: "检测放量突破阻力位信号。适用于股价接近已知阻力位时。",
    category: "trend",
    coreRules: [1, 2, 3],
    requiredData: ["kline", "news"],
    aliases: ["放量突破", "突破"],
    defaultPriority: 30,
    marketRegimes: ["trending_up"],
    instructions: `放量突破（Volume Breakout Strategy）

突破判定标准：

1. 阻力位识别
   - 获取阻力位，通常为 20 日高点或前期震荡平台顶部。

2. 量能确认
   - 当日成交量 > 5 日均量的 2 倍。
   - 量比 > 2.0 确认。

3. 价格确认
   - 收盘价必须站上阻力位。
   - 收盘应在当日振幅上方 30%（强势收盘）。
   - 突破后乖离率检查：仍需 < 5%，避免追高。

4. 后续验证
   - 次日开盘应在突破位之上，区分真突破与假突破。

5. 风险过滤
   - 检查无重大利空。
   - PE 不应过高（避免泡沫型突破）。`,
    scoreAdjust: `- 放量突破确认：+12
- 突破伴随板块共振（板块也走强）：额外 +5
- 理想买点设在突破位附近，止损设在突破位下方 3%。`,
  },
  {
    id: "one_yang_three_yin",
    displayName: "一阳夹三阴",
    description: "检测一阳夹三阴K线整理形态，趋势延续入场信号。",
    category: "pattern",
    coreRules: [2, 4],
    requiredData: ["kline"],
    aliases: ["一阳穿三阴", "一阳夹三阴"],
    defaultPriority: 110,
    instructions: `一阳夹三阴（One Yang Three Yin Strategy）

形态定义（最近 5 个交易日）：

1. 第 1 日：大阳线（收盘价 > 开盘价，实体 > 股价的 2%）。
2. 第 2-4 日：连续三根阴线或小 K 线：
   - 每根 K 线最低价不跌破第 1 日开盘价。
   - 成交量应逐步萎缩（量比 < 0.8）。
   - 三根 K 线应收在第 1 日实体范围内。
3. 第 5 日：又一根阳线，收盘价突破第 1 日收盘价。

如何使用工具评估：
1. 获取最近 10 日数据。
2. 检查最后 5 根 K 线是否符合上述形态。
3. 确认多头排列（MA5 > MA10 > MA20）。

评分调整：
- 形态成立 + 趋势看多：+15
- 形态成立但趋势不明：+5
- 理想买点设在第 5 日收盘价附近，止损设在第 1 日开盘价下方。`,
    scoreAdjust: `- 形态成立 + 趋势看多：+15
- 形态成立但趋势不明：+5`,
  },
];

export function getStrategyById(id: string): AnalysisStrategy | undefined {
  return ANALYSIS_STRATEGIES.find((s) => s.id === id);
}

/** 按 id 列表解析为策略对象（忽略无效 id），保持入参顺序 */
export function getStrategiesByIds(ids: string[]): AnalysisStrategy[] {
  const result: AnalysisStrategy[] = [];
  for (const id of ids) {
    const s = getStrategyById(id);
    if (s) result.push(s);
  }
  return result;
}

/** 按分类预分组（模块级常量，UI 直接复用，避免每次渲染重新分配与排序） */
export const STRATEGY_GROUPS: Record<StrategyCategory, AnalysisStrategy[]> = (() => {
  const groups: Record<StrategyCategory, AnalysisStrategy[]> = {
    trend: [],
    pattern: [],
    reversal: [],
    framework: [],
  };
  for (const s of ANALYSIS_STRATEGIES) groups[s.category].push(s);
  (Object.keys(groups) as StrategyCategory[]).forEach((k) =>
    groups[k].sort((a, b) => a.defaultPriority - b.defaultPriority),
  );
  return groups;
})();

/** 将选中策略渲染为追加到 base prompt 的「附加分析策略」章节（空数组返回空串，保证回归安全） */
export function strategiesToPromptSection(strategies: AnalysisStrategy[]): string {
  if (strategies.length === 0) return "";
  const blocks = strategies.map((s, i) => {
    const parts = [
      `### ${i + 1}. ${s.displayName}（${s.id}，分类：${STRATEGY_CATEGORY_LABELS[s.category]}）`,
      s.instructions.trim(),
    ];
    if (s.scoreAdjust) parts.push(`评分调整建议：\n${s.scoreAdjust.trim()}`);
    return parts.join("\n\n");
  });
  return [
    "## 附加分析策略（多策略透镜）",
    "请根据以下选中的分析策略视角，对上述持仓与场内 ETF 数据做针对性分析：",
    ...blocks,
  ].join("\n\n");
}
