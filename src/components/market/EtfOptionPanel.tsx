/**
 * ETF 期权面板（T 型报价 + 希腊字母 + 隐含波动率）
 *
 * 三级联动：品种（50ETF/300ETF/...）→ 到期月 → T 型链。
 * T 型表：认购(call)左 / 行权价中 / 认沽(put)右，含最新价、涨跌幅、IV、Delta 列。
 * 选中合约：详情卡展示完整希腊字母（Δ/Γ/Θ/V/Ρ）+ IV + 合约信息 + 标的 ETF 日 K。
 *
 * 数据：T 型链来自新浪自实现（src/services/etfOptions.ts）；
 *      希腊字母与 IV 由 src/lib/optionPricing.ts 纯前端 Black-Scholes 计算（需标的最新价 S）；
 *      标的 ETF 日 K 复用 dataSourceService.fetchEtfKLine。
 *
 * 门控：开启「增强数据源」且东财增强配置 proxy 后展示，否则占位提示。
 *
 * @module market/EtfOptionPanel
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CandlestickChart, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import StockApiDefault from "stock-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ETF_OPTION_UNDERLYINGS,
  EtfOptionDisabledError,
  fetchEtfOptionChain,
  fetchEtfOptionMonths,
  type EtfOptionChainRow,
  type EtfOptionContract,
} from "@/services/etfOptions";
import { bsGreeks, impliedVol, type OptionType } from "@/lib/optionPricing";
import { dataSourceService } from "@/adapters/datasource/service";
import { useSettingsStore } from "@/stores/settings";
import type { KLineData } from "@/types";

/** 无风险年化利率（近似中债短端） */
const RISK_FREE_RATE = 0.02;
const UNDERLYING_PREFIX = "sh";

function pctColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-muted-foreground";
  return v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground";
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtNum(v: number, digits = 4): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "-";
}

interface ContractGreeks {
  iv: number; // 年化小数，NaN 表示不可解
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

/** 由市场报价反推 IV，再用 IV（不可解时回退 0.2）计算五大希腊字母 */
function computeGreeks(c: EtfOptionContract, S: number): ContractGreeks {
  const T = c.daysLeft / 365;
  const type = (c.side === "call" ? "call" : "put") as OptionType;
  const base = { type, S, K: c.strike, T, r: RISK_FREE_RATE };
  const iv = Number.isFinite(S) && S > 0 ? impliedVol(c.last, base) : NaN;
  const sigma = Number.isFinite(iv) ? iv : 0.2;
  const g = bsGreeks({ ...base, sigma });
  return { iv, ...g };
}

/** 轻量蜡烛图（标的 ETF 日 K），涨红跌绿 */
function MiniCandleChart({ data }: { data: KLineData[] }) {
  const W = 320;
  const H = 120;
  const pad = 8;
  if (!data || data.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">暂无 K 线数据</div>;
  }
  const recent = data.slice(-40);
  const min = Math.min(...recent.map((d) => d.low));
  const max = Math.max(...recent.map((d) => d.high));
  const range = max - min || 1;
  const n = recent.length;
  const step = (W - pad * 2) / n;
  const bw = Math.max(1.5, step * 0.6);
  const y = (v: number) => pad + (1 - (v - min) / range) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
      {recent.map((d, i) => {
        const x = pad + i * step + step / 2;
        const up = d.close >= d.open;
        const color = up ? "var(--up)" : "var(--down)";
        const yo = y(d.open);
        const yc = y(d.close);
        const top = Math.min(yo, yc);
        const h = Math.max(1, Math.abs(yc - yo));
        return (
          <g key={d.date}>
            <line
              x1={x}
              y1={y(d.high)}
              x2={x}
              y2={y(d.low)}
              style={{ stroke: color }}
              strokeWidth={1}
            />
            <rect x={x - bw / 2} y={top} width={bw} height={h} style={{ fill: color }} />
          </g>
        );
      })}
    </svg>
  );
}

function DisabledPlaceholder() {
  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <CandlestickChart className="h-3.5 w-3.5 text-primary" />
          ETF 期权 T 型报价
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 space-y-2">
          <TriangleAlert className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            需开启「设置 → 数据源 → 增强数据源（同花顺/巨潮）」并在东财增强中配置 Cloudflare Worker
            反代
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EtfOptionPanel() {
  const extraEnabled = useSettingsStore((s) => s.settings.dataSource.extraSources.enabled);
  const emMode = useSettingsStore((s) => s.settings.dataSource.eastmoney.mode);
  const emProxy = useSettingsStore((s) => s.settings.dataSource.eastmoney.proxyUrl);
  const proxyReady = emMode === "proxy" && !!emProxy;
  const disabled = !extraEnabled || !proxyReady;

  const [underlying, setUnderlying] = useState(ETF_OPTION_UNDERLYINGS[0].code);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>("");
  const [chain, setChain] = useState<EtfOptionChainRow[]>([]);
  const [underlyingPrice, setUnderlyingPrice] = useState<number>(NaN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EtfOptionContract | null>(null);
  const [kline, setKline] = useState<KLineData[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);

  // 标的最新价（用于 IV / 希腊字母计算）
  useEffect(() => {
    let alive = true;
    StockApiDefault.stocks.auto
      .getStocks([`${UNDERLYING_PREFIX}${underlying}`])
      .then((qs) => {
        if (!alive) return;
        const q = qs?.[0];
        setUnderlyingPrice(q && q.now > 0 ? q.now : NaN);
      })
      .catch(() => alive && setUnderlyingPrice(NaN));
    return () => {
      alive = false;
    };
  }, [underlying]);

  const loadMonths = useCallback(async (u: string) => {
    setLoading(true);
    setError(null);
    try {
      const ms = await fetchEtfOptionMonths(u);
      setMonths(ms);
      setMonth((prev) => (ms.includes(prev) ? prev : (ms[0] ?? "")));
    } catch (e) {
      if (!(e instanceof EtfOptionDisabledError)) setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChain = useCallback(async (u: string, m: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchEtfOptionChain(u, m);
      setChain(rows);
      setSelected(null);
    } catch (e) {
      if (!(e instanceof EtfOptionDisabledError)) setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKline = useCallback(async (code: string) => {
    setKlineLoading(true);
    try {
      const d = await dataSourceService.fetchEtfKLine(code, "3m");
      setKline(d);
    } catch {
      setKline([]);
    } finally {
      setKlineLoading(false);
    }
  }, []);

  // 到期月列表
  useEffect(() => {
    if (disabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据加载需在 effect 内触发 setState
    void loadMonths(underlying);
  }, [underlying, disabled, loadMonths]);

  // T 型链
  useEffect(() => {
    if (disabled || !month) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据加载需在 effect 内触发 setState
    void loadChain(underlying, month);
  }, [underlying, month, disabled, loadChain]);

  // 选中合约的标的 ETF 日 K
  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据加载需在 effect 内触发 setState
    void loadKline(selected.underlyingCode);
  }, [selected, loadKline]);

  const greeksMap = useMemo(() => {
    const m = new Map<string, ContractGreeks>();
    for (const row of chain) {
      if (row.call) m.set(row.call.code, computeGreeks(row.call, underlyingPrice));
      if (row.put) m.set(row.put.code, computeGreeks(row.put, underlyingPrice));
    }
    return m;
  }, [chain, underlyingPrice]);

  if (disabled) return <DisabledPlaceholder />;

  const underlyingName =
    ETF_OPTION_UNDERLYINGS.find((u) => u.code === underlying)?.name ?? underlying;
  const selG = selected ? greeksMap.get(selected.code) : undefined;

  return (
    <Card className="card-hover">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <CandlestickChart className="h-3.5 w-3.5 text-primary" />
          ETF 期权 T 型报价
          {!Number.isFinite(underlyingPrice) && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              标的价格获取中…
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 三级联动选择 */}
        <div className="flex flex-wrap gap-2">
          <select
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {ETF_OPTION_UNDERLYINGS.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name} ({u.code})
              </option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            disabled={months.length === 0}
          >
            {months.length === 0 && <option value="">—</option>}
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoading(true);
              fetchEtfOptionChain(underlying, month)
                .then((rows) => setChain(rows))
                .catch((e) => {
                  if (!(e instanceof EtfOptionDisabledError)) setError(e?.message ?? "刷新失败");
                })
                .finally(() => setLoading(false));
            }}
            disabled={loading || !month}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            刷新
          </Button>
        </div>

        {error && <div className="text-center py-3 text-sm text-down">{error}</div>}

        {/* T 型表 */}
        {chain.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="px-1 py-1 text-right font-normal">最新价</th>
                  <th className="px-1 py-1 text-right font-normal">涨跌幅</th>
                  <th className="px-1 py-1 text-right font-normal">IV</th>
                  <th className="px-1 py-1 text-right font-normal">Δ</th>
                  <th className="px-1 py-1 text-center font-normal text-foreground">行权价</th>
                  <th className="px-1 py-1 text-left font-normal">Δ</th>
                  <th className="px-1 py-1 text-left font-normal">IV</th>
                  <th className="px-1 py-1 text-left font-normal">涨跌幅</th>
                  <th className="px-1 py-1 text-left font-normal">最新价</th>
                </tr>
              </thead>
              <tbody>
                {chain.map((row) => {
                  const cg = row.call ? greeksMap.get(row.call.code) : undefined;
                  const pg = row.put ? greeksMap.get(row.put.code) : undefined;
                  return (
                    <tr key={row.strike} className="border-b border-border/20 hover:bg-muted/30">
                      {/* call */}
                      {row.call ? (
                        <Cell
                          contract={row.call}
                          g={cg}
                          onClick={() => setSelected(row.call ?? null)}
                          selected={selected?.code === row.call.code}
                          side="call"
                        />
                      ) : (
                        <td className="px-1 py-1 text-right text-muted-foreground/40" colSpan={4}>
                          —
                        </td>
                      )}
                      {/* strike */}
                      <td className="px-1 py-1 text-center font-semibold text-foreground">
                        {row.strike.toFixed(4)}
                      </td>
                      {/* put */}
                      {row.put ? (
                        <Cell
                          contract={row.put}
                          g={pg}
                          onClick={() => setSelected(row.put ?? null)}
                          selected={selected?.code === row.put.code}
                          side="put"
                        />
                      ) : (
                        <td className="px-1 py-1 text-left text-muted-foreground/40" colSpan={4}>
                          —
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 选中合约详情 */}
        {selected && (
          <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">
                {selected.name || selected.code}{" "}
                <span className={selected.side === "call" ? "text-up" : "text-down"}>
                  {selected.side === "call" ? "认购" : "认沽"}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                标的 {underlyingName} · 到期 {selected.expireDate} · 剩 {selected.daysLeft} 天
              </div>
            </div>

            {/* 希腊字母 + IV */}
            <div className="grid grid-cols-3 gap-2">
              <GreekStat label="IV" value={selG ? fmtPct(selG.iv * 100, 1) : "-"} />
              <GreekStat label="Delta Δ" value={selG ? fmtNum(selG.delta, 3) : "-"} />
              <GreekStat label="Gamma Γ" value={selG ? fmtNum(selG.gamma, 4) : "-"} />
              <GreekStat label="Theta Θ" value={selG ? fmtNum(selG.theta, 3) : "-"} />
              <GreekStat label="Vega V" value={selG ? fmtNum(selG.vega, 3) : "-"} />
              <GreekStat label="Rho Ρ" value={selG ? fmtNum(selG.rho, 3) : "-"} />
            </div>

            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>最新 {selected.last.toFixed(4)}</span>
              <span className={pctColor(selected.changePct)}>{fmtPct(selected.changePct)}</span>
              <span>
                买 {selected.bid.toFixed(4)} / 卖 {selected.ask.toFixed(4)}
              </span>
              <span>持仓 {selected.openInterest}</span>
            </div>

            {/* 标的 ETF 日 K */}
            <div className="rounded-lg border border-border/30 bg-background/40 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {underlyingName} 日 K
                </span>
                {klineLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <MiniCandleChart data={kline} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** T 型表单元格（call=右对齐，put=左对齐） */
function Cell({
  contract,
  g,
  onClick,
  selected,
  side,
}: {
  contract: EtfOptionContract;
  g: ContractGreeks | undefined;
  onClick: () => void;
  selected: boolean;
  side: "call" | "put";
}) {
  const align = side === "call" ? "text-right" : "text-left";
  return (
    <td className={`px-1 py-1 ${align}`} colSpan={4}>
      <button
        type="button"
        onClick={onClick}
        className={`block w-full ${align} rounded px-1 py-0.5 hover:bg-primary/10 ${
          selected ? "bg-primary/15 ring-1 ring-primary/40" : ""
        }`}
      >
        <div className="text-foreground">{contract.last.toFixed(4)}</div>
        <div className={`text-[10px] ${pctColor(contract.changePct)}`}>
          {fmtPct(contract.changePct)}
        </div>
        <div className="text-[10px] text-muted-foreground">{g ? fmtPct(g.iv * 100, 1) : "-"}</div>
        <div className="text-[10px] text-muted-foreground">{g ? fmtNum(g.delta, 2) : "-"}</div>
      </button>
    </td>
  );
}

function GreekStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/30 bg-background/40 px-2 py-1.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-semibold text-foreground">{value}</div>
    </div>
  );
}
