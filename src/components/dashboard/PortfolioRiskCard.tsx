/**
 * 组合风险分析卡片（纯本地计算）
 *
 * 基于各持仓近一年净值序列，展示：
 *   - 组合最大回撤(%)
 *   - 行业集中度 HHI（0-100，越高越集中）
 *   - 头部行业权重(%)
 *   - 持仓 / 有净值覆盖数
 *   - 持仓相关性矩阵热力图（红=高正相关·集中风险，绿=负相关·分散）
 *
 * 数据不足时优雅降级：无净值→提示；持仓 <2→不画相关性矩阵。
 * 颜色遵循 A 股惯例（涨红跌绿），风险指标用红色强调。
 *
 * @module dashboard/PortfolioRiskCard
 */

import { useEffect, useState } from "react";
import { useHoldingsStore } from "@/stores/holdings";
import { computePortfolioRisk, type PortfolioRiskResult } from "@/services/portfolioRisk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert } from "lucide-react";
import { SECTOR_LABELS } from "@/lib/labels";

/** 相关系数 → 红/绿背景 + 前景色（高相关红、负相关绿、近 0 灰） */
function corrColor(v: number): { bg: string; fg: string } {
  if (Number.isNaN(v)) return { bg: "rgba(156,163,175,0.18)", fg: "#475569" };
  if (v >= 0) {
    const a = 0.12 + 0.7 * v;
    return { bg: `rgba(239,68,68,${a.toFixed(2)})`, fg: v > 0.5 ? "#fff" : "#7f1d1d" };
  }
  const a = 0.12 + 0.7 * -v;
  return { bg: `rgba(34,197,94,${a.toFixed(2)})`, fg: -v > 0.5 ? "#fff" : "#14532d" };
}

export default function PortfolioRiskCard() {
  const holdings = useHoldingsStore((s) => s.holdings);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortfolioRiskResult | null>(null);

  useEffect(() => {
    if (holdings.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    computePortfolioRisk(holdings)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [holdings]);

  if (holdings.length === 0) return null;

  const topSectorLabel =
    data?.topSector && SECTOR_LABELS[data.topSector.name]
      ? SECTOR_LABELS[data.topSector.name]
      : (data?.topSector?.name ?? "-");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5" />
          组合风险分析
          <span className="text-[10px] font-normal text-muted-foreground">近一年净值</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-[200px]">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-xs text-muted-foreground py-6 text-center">暂无可计算的风险数据</p>
        ) : (
          <div className="space-y-4">
            {/* 指标行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="组合最大回撤"
                value={data.maxDrawdown != null ? `${data.maxDrawdown.toFixed(2)}%` : "-"}
                tone="text-up"
                hint="负值=最大亏损幅度"
              />
              <Stat
                label="行业集中度 HHI"
                value={data.sectorHHI != null ? data.sectorHHI.toFixed(1) : "-"}
                tone=""
                hint="0-100，越高越集中"
              />
              <Stat
                label="头部行业权重"
                value={topSectorLabel !== "-" ? `${data.topSector!.weight.toFixed(1)}%` : "-"}
                tone=""
                hint={topSectorLabel}
              />
              <Stat
                label="持仓 / 有净值"
                value={`${data.holdingsCount} / ${data.withNav}`}
                tone=""
                hint={data.withNav < data.holdingsCount ? "部分无净值·已跳过" : "全部覆盖"}
              />
            </div>

            {/* 相关性热力矩阵 */}
            {data.correlation ? (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">
                  持仓相关性矩阵（红=高正相关·集中风险，绿=负相关·分散）
                </p>
                <div className="overflow-x-auto">
                  <table className="border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                      <tr>
                        <th />
                        {data.correlation.labels.map((l, i) => (
                          <th
                            key={i}
                            className="text-[9px] font-medium text-muted-foreground p-0.5"
                            title={data.correlation!.codes[i]}
                          >
                            {l}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.correlation.matrix.map((row, i) => (
                        <tr key={i}>
                          <th
                            className="text-[9px] font-medium text-muted-foreground pr-1 text-right"
                            title={data.correlation!.codes[i]}
                          >
                            {data.correlation!.labels[i]}
                          </th>
                          {row.map((v, j) => {
                            const c = corrColor(v);
                            return (
                              <td
                                key={j}
                                className="text-center rounded"
                                style={{
                                  background: c.bg,
                                  color: c.fg,
                                  width: 34,
                                  height: 26,
                                  fontSize: 10,
                                }}
                              >
                                {Number.isNaN(v) ? "-" : v.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                需至少 2 只有净值数据的持仓才能计算相关性矩阵（当前有净值 {data.withNav} 只）。
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-base font-bold tracking-tight ${tone}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5 truncate" title={hint}>
        {hint}
      </p>
    </div>
  );
}
