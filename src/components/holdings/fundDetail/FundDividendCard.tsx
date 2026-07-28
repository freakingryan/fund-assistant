/**
 * 分红派送历史卡片（东财增强，门控）
 *
 * 展示单只基金的分红送配历史：累计每份分红、各次除息日 / 权益登记日 /
 * 每份分红(元) / 发放日。颜色遵循 A 股惯例（分红为正向，红涨）。
 *
 * 门控：仅当 settings.dataSource.eastmoney.enabled=true 才请求东财；
 *       未开启时显示引导提示，不产生任何请求。
 *
 * @module holdings/FundDividendCard
 */

import { useEffect, useState } from "react";
import { Gift, Loader2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchFundDividend, type FundDividendResult } from "@/services/fundDividend";
import type { EastmoneyDataSourceConfig } from "@/types";

export default function FundDividendCard({
  code,
  config,
}: {
  code: string;
  config: EastmoneyDataSourceConfig;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FundDividendResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!config.enabled || !code) {
      setData(null);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    fetchFundDividend(code, config)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, config]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Gift className="h-3.5 w-3.5" />
          分红派送历史
          <span className="text-[10px] font-normal text-muted-foreground">东财</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!config.enabled ? (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground py-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              分红派送历史需开启东财增强。到「设置 →
              数据源」打开「东财资金面增强」后，即可展示该基金的分红送配记录。
            </span>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-[160px]">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {loaded ? "暂无分红派送记录（东财未收录或当前不可达）" : ""}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <span className="text-[10px] text-muted-foreground">累计每份分红</span>
                <p className="text-xl font-bold tracking-tight text-up">
                  +{data.totalPerShare.toFixed(4)} 元
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">共 {data.items.length} 次</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/60">
                    <th className="text-left font-medium py-1 pr-2">除息日</th>
                    <th className="text-left font-medium py-1 pr-2">权益登记日</th>
                    <th className="text-right font-medium py-1 pr-2">每份(元)</th>
                    <th className="text-left font-medium py-1 pr-2">发放日</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-2 font-mono">{d.exDividendDate ?? "-"}</td>
                      <td className="py-1 pr-2 font-mono">{d.equityRecordDate ?? "-"}</td>
                      <td className="py-1 pr-2 text-right font-mono text-up">
                        {d.dividendPerShare != null ? d.dividendPerShare.toFixed(4) : "-"}
                      </td>
                      <td className="py-1 pr-2 font-mono">{d.payDate ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              累计每份分红反映分红再投资强度；分红为现金派现，到账后净值除息下调。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
