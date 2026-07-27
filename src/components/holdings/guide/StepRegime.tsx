/**
 * 步骤 1 — 看大环境：市场 Regime（牛/熊/震荡）。
 * 用大白话解释「为什么先看大盘」，并把 regime 与东财因子接入状态翻译给用户。
 *
 * @module components/holdings/guide/StepRegime
 */

import type { MarketRegime, EmFactors } from "@/services/decision/types";

interface Props {
  regime?: MarketRegime;
  em?: EmFactors;
  /** 市场 regime 是否正在加载 */
  regimeLoading?: boolean;
  /** 东财 overlay 是否正在加载 */
  emLoading?: boolean;
}

const TREND_LABEL: Record<string, string> = {
  bull: "多头 · 偏向上",
  bear: "空头 · 偏向下",
  neutral: "震荡 · 中性",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export default function StepRegime({ regime, em, regimeLoading, emLoading }: Props) {
  const trend = regime?.trend;
  const trendTone =
    trend === "bull" ? "text-up" : trend === "bear" ? "text-down" : "text-amber-500";
  const momentum = regime?.momentum60;
  const emReady =
    !!em && (em.capitalFlow.available || em.sector.available || em.peerRank.available);
  const LOADING = "加载中…";

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
        先别急着看具体指标。<b className="text-foreground">大盘环境决定「水有多深」</b>——
        牛市里多数股票随涨，熊市里再好的个股也难独善。先看清楚现在是大盘向上、向下还是来回震荡，
        能帮你把「个股自身的信号」和「被大盘带着走（β）」区分开。
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">当前市场状态</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat
            label="整体趋势"
            value={regimeLoading ? LOADING : trend ? TREND_LABEL[trend] : "未计算"}
            tone={regimeLoading ? undefined : trend ? trendTone : undefined}
          />
          <Stat
            label="趋势强度"
            value={
              regimeLoading ? LOADING : regime ? `${(regime.strength * 100).toFixed(0)}%` : "未计算"
            }
          />
          <Stat
            label="沪深300 近60日"
            value={
              regimeLoading
                ? LOADING
                : momentum != null
                  ? `${momentum >= 0 ? "+" : ""}${momentum.toFixed(1)}%`
                  : "—"
            }
            tone={
              regimeLoading
                ? undefined
                : momentum != null
                  ? momentum >= 0
                    ? "text-up"
                    : "text-down"
                  : undefined
            }
          />
          <Stat
            label="均线排列"
            value={
              regimeLoading
                ? LOADING
                : regime
                  ? regime.maBull
                    ? "多头排列"
                    : "空头排列"
                  : "未计算"
            }
            tone={
              regimeLoading
                ? undefined
                : regime
                  ? regime.maBull
                    ? "text-up"
                    : "text-down"
                  : undefined
            }
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">增强数据接入</h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="资金面"
            value={emLoading ? LOADING : em?.capitalFlow.available ? "已接入" : "未接入"}
            tone={
              emLoading
                ? undefined
                : em?.capitalFlow.available
                  ? "text-up"
                  : "text-muted-foreground"
            }
          />
          <Stat
            label="板块"
            value={emLoading ? LOADING : em?.sector.available ? "已接入" : "未接入"}
            tone={
              emLoading ? undefined : em?.sector.available ? "text-up" : "text-muted-foreground"
            }
          />
          <Stat
            label="同类排名"
            value={emLoading ? LOADING : em?.peerRank.available ? "已接入" : "未接入"}
            tone={
              emLoading ? undefined : em?.peerRank.available ? "text-up" : "text-muted-foreground"
            }
          />
        </div>
        {emLoading ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            增强数据（资金面 / 板块 / 排名）正在从数据源加载…
          </p>
        ) : (
          !emReady && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              资金面 / 板块 / 排名需在「设置 → 东财数据源」中开启并部署代理后才可用；
              未接入时向导这些维度仅作通识说明，不影响基础评分。
            </p>
          )
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        👉 下一步：看看这只基金的综合评分处在什么位置。
      </p>
    </div>
  );
}
