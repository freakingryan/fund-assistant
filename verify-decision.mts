/**
 * 离线验证脚本：用 App 同一套决策引擎，对两只联接基金对应的底层 ETF 真实 K 线跑一遍，
 * 输出与「智能决策建议」卡片完全一致的综合评分 / 八态动作 / 买入理由 / 风险因子。
 *
 * 说明：本脚本验证的是「技术面核心」——趋势/乖离/动量/量能/MACD/形态 六维融合，
 * 这正是 buildDecision 的主导输入（与 App 的 computeFundTrendScore 完全一致）。
 * 东财 overlay(em, ≤±12) 与 市场 regime 护栏为附加层：仅在明确牛/熊市中对乐观/悲观
 * 打折，中性市无影响；本脚本主流程不含 em（避免引入依赖 JSONP 的 DataSourceService），
 * 但会 (a) 在结论中标注其对最终分数的潜在影响，并 (b) 用合成 em 隔离验证资金背离 / 板块逆风护栏。
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
import type { EmFactors } from "@/services/decision/types";
import type { KLineData } from "@/types";

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
      `  原始分 rawScore=${d.rawScore}  综合评分 score=${d.score}  评级=${d.ratingLabel}(${d.rating})  动作=${d.actionLabel}(${d.finalAction})  信号类型=${d.signalType}`,
    );
    console.log(
      `  bullRatio=${fmt(d.bullRatio)}  conflict=${d.conflict}  trendBearish=${d.trendBearish}  midTermDown=${d.midTermDown}(${fmt(d.midTermReturnPct)}%)  lowConfidence=${d.lowConfidence}`,
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

  // ─── 合成护栏隔离验证（资金背离 / 板块逆风）───
  // 用一段确定性上行 K 线（中期不下行、无 reversion），隔离验证 em 两大护栏是否生效。
  await verifySyntheticGuardrails();
}

/** 构造 80 根确定性上行 K 线（MA20>MA60，区间收益>0 → 不触发中期下行/reversion） */
function synthUptrendKlines(): KLineData[] {
  const out: KLineData[] = [];
  let close = 100;
  const base = new Date(2026, 0, 1);
  for (let i = 0; i < 80; i++) {
    close += 1.0 + Math.sin(i / 6) * 0.3; // 震荡上行
    const open = close - 0.5;
    const high = close + 0.7;
    const low = open - 0.7;
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      date: d.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 10000,
    });
  }
  return out;
}

async function verifySyntheticGuardrails() {
  console.log(`\n████ 合成护栏隔离验证（确定性上行 K 线，midTermDown=false） ████`);
  const klines = synthUptrendKlines();
  const patterns = detectPatterns(klines);
  const signalResult = evaluateSignal(klines, patterns);
  const ind = computeStockSdkIndicators(klines);
  const strategies = evaluateStrategies(klines, ind);
  const base = buildDecision({ klines, patterns, signalResult, ind, strategies });
  console.log(
    `  基线(无em): 动作=${base.actionLabel}(${base.finalAction}) 评级=${base.ratingLabel} midTermDown=${base.midTermDown} signalType=${base.signalType}`,
  );

  const synthEm = (capital: number | null, sector: number | null): EmFactors => ({
    capitalFlow: { available: capital != null, combinedScore: capital },
    sector: { available: sector != null, combinedScore: sector },
    peerRank: { available: false, percentile: null },
  });

  // 资金背离：技术偏多 + 资金面分 35(<50) → 预期降级观察/持有
  const dCap = buildDecision({
    klines,
    patterns,
    signalResult,
    ind,
    strategies,
    em: synthEm(35, 60),
  });
  console.log(`\n  [资金背离] capitalScore=35 → 动作=${dCap.actionLabel}(${dCap.finalAction}) 评级=${dCap.ratingLabel}`);
  dCap.guardrails.forEach((g) => console.log(`    ! ${g.kind}: ${g.description}`));

  // 板块逆风：技术偏多 + 板块分 35(<40) → 预期降级观察/持有
  const dSec = buildDecision({
    klines,
    patterns,
    signalResult,
    ind,
    strategies,
    em: synthEm(60, 35),
  });
  console.log(`\n  [板块逆风] sectorScore=35 → 动作=${dSec.actionLabel}(${dSec.finalAction}) 评级=${dSec.ratingLabel}`);
  dSec.guardrails.forEach((g) => console.log(`    ! ${g.kind}: ${g.description}`));

  // 中性资金/板块：技术偏多 + 资金 60 / 板块 55 → 预期护栏不触发（保持买入侧）
  const dOk = buildDecision({
    klines,
    patterns,
    signalResult,
    ind,
    strategies,
    em: synthEm(60, 55),
  });
  console.log(`\n  [中性确认] capital=60/sector=55 → 动作=${dOk.actionLabel}(${dOk.finalAction}) 评级=${dOk.ratingLabel} 护栏数=${dOk.guardrails.length}`);
}

run().catch((e) => {
  console.error("运行失败:", e);
  process.exit(1);
});
