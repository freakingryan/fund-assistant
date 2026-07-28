/**
 * 离线验证脚本：用 App 同一套决策引擎，对两只联接基金对应的底层 ETF 真实 K 线跑一遍，
 * 输出与「智能决策建议」卡片完全一致的综合评分 / 八态动作 / 买入理由 / 风险因子。
 *
 * 说明：本脚本验证的是「技术面核心」——趋势/乖离/动量/量能/MACD/形态 六维融合，
 * 这正是 buildDecision 的主导输入（与 App 的 computeFundTrendScore 完全一致）。
 * 东财 overlay(em, ≤±12) 与 市场 regime 护栏为附加层：仅在明确牛/熊市中对乐观/悲观
 * 打折，中性市无影响；本脚本不含这两项（避免引入依赖 JSONP/import.meta.env 的DataSourceService），
 * 但会在结论中标注其对最终分数的潜在影响。
 *
 * 运行：NODE_OPTIONS="" node_modules/.bin/tsx --tsconfig tsconfig.app.json verify-decision.mts
 */
import { fetchTencentKline } from "@/adapters/datasource/tencentKline";
import { periodToCount } from "@/adapters/datasource/periodConfig";
import { detectPatterns } from "@/services/klinePatterns";
import { evaluateSignal } from "@/services/signalEngine";
import { computeStockSdkIndicators } from "@/services/stockSdkIndicators";
import { evaluateStrategies } from "@/services/strategyLayer";
import { buildDecision } from "@/services/decision/decisionEngine";

const TARGETS = [
  {
    otc: "017193",
    otcName: "天弘中证工业有色金属主题ETF发起联接C",
    etf: "159157",
    etfName: "有色金属ETF",
  },
  {
    otc: "018927",
    otcName: "南方中证电池ETF联接C",
    etf: "159147",
    etfName: "电池ETF",
  },
];

const PERIOD = "3m";

function fmt(n: number, d = 2) {
  return n.toFixed(d);
}

async function run() {
  for (const t of TARGETS) {
    console.log(`\n████ ${t.otcName} (${t.otc}) → 底层 ${t.etfName} (${t.etf}) ████`);
    const klines = await fetchTencentKline(t.etf, periodToCount(PERIOD), "qfq");
    if (!klines || klines.length === 0) {
      console.log("  ✗ 无法获取底层 ETF K 线，无法决策");
      continue;
    }
    const first = klines[0];
    const last = klines[klines.length - 1];
    const isRealKline = klines.some((k) => k.high > k.low);
    console.log(
      `  K线: ${klines.length} 根 (${first.date} → ${last.date}) | 区间涨跌: ${fmt(
        ((last.close - first.close) / first.close) * 100,
      )}% | 最新收盘 ${last.close} | isRealKline=${isRealKline}`,
    );

    const patterns = detectPatterns(klines);
    const signalResult = evaluateSignal(klines, patterns);
    const ind = computeStockSdkIndicators(klines);
    const strategies = evaluateStrategies(klines, ind);

    const d = buildDecision({
      klines,
      patterns,
      signalResult,
      ind,
      strategies,
      lowConfidence: !isRealKline,
    });

    console.log(`\n  ── 技术面核心决策 ──`);
    console.log(
      `  原始分 rawScore=${d.rawScore}  综合评分 score=${d.score}  评级=${d.ratingLabel}(${d.rating})  动作=${d.actionLabel}(${d.finalAction})`,
    );
    console.log(
      `  bullRatio=${fmt(d.bullRatio)}  conflict=${d.conflict}  trendBearish=${d.trendBearish}  lowConfidence=${d.lowConfidence}`,
    );
    console.log(`  bullPower=${fmt(d.bullPower)}  bearPower=${fmt(d.bearPower)}`);
    console.log(`  买入理由(top):`);
    d.bullReasons.forEach((r) =>
      console.log(`    + ${r.label}  [权重 ${fmt(r.weight)} / 类别 ${r.category}]`),
    );
    console.log(`  风险因子(top):`);
    d.bearReasons.forEach((r) =>
      console.log(`    - ${r.label}  [权重 ${fmt(r.weight)} / 类别 ${r.category}]`),
    );
    if (d.guardrails.length) {
      console.log(`  护栏触发:`);
      d.guardrails.forEach((g) => console.log(`    ! ${g.kind}: ${g.description}`));
    }
    console.log(`  人话总结: ${d.summary}`);

    // 近期技术事件（金叉/死叉/SAR 等）抽样
    console.log(`\n  近期技术指标事件 (倒序前10):`);
    ind.signals
      .slice(0, 10)
      .forEach((s) => console.log(`    · ${s.date} ${s.type} (${s.direction}) ${s.label}`));
    const sar = ind.latest.sar?.trend ?? "n/a";
    const kdjK = ind.latest.kdj?.k?.toFixed(1) ?? "n/a";
    const bias = ind.latest.bias
      ? Object.entries(ind.latest.bias)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}=${Number(v).toFixed(1)}%`)
          .join(" ")
      : "n/a";
    console.log(`  SAR 趋势=${sar}  KDJ.K=${kdjK}  乖离=${bias}`);
    console.log(
      `  最近5日收盘: ${klines
        .slice(-5)
        .map((k) => `${k.date}:${k.close}`)
        .join("  ")}`,
    );
  }
  console.log(
    "\n[注] 以上为技术面核心决策。东财 overlay(em, 最大±12) 与 市场 regime 护栏为附加层，" +
      "仅在明确牛/熊市中对乐观/悲观打分，中性市无影响；启用东财增强后可能使分数再偏移数点，但不改变主导趋势结论。",
  );
}

run().catch((e) => {
  console.error("运行失败:", e);
  process.exit(1);
});
