import { useHoldingsStore } from "@/stores/holdings";
import { Badge } from "@/components/ui/badge";
import SearchableSelect from "@/components/ui/searchable-select";
import { useFundDetail } from "@/hooks/useFundDetailController";
import { TYPE_LABELS, SECTOR_LABELS, MARKET_LABELS } from "@/lib/labels";

/** 详情页标题行：基金名称/标签 + 基金切换下拉 */
export default function FundHeader() {
  const { fund, handleSwitchFund, fundIsOnExchangeEtf, etfCode } = useFundDetail();
  const holdings = useHoldingsStore((s) => s.holdings);
  if (!fund) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">
          {fund.name || fund.code}
        </h1>
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{fund.code}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="secondary" className="text-[10px]">
            {MARKET_LABELS[fund.market] || fund.market}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {TYPE_LABELS[fund.type] || fund.type}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {SECTOR_LABELS[fund.sector] || fund.sector}
          </Badge>
          {fundIsOnExchangeEtf && (
            <Badge variant="outline" className="text-[10px]">
              场内ETF类
            </Badge>
          )}
          {etfCode && (
            <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">
              ETF {etfCode}
            </Badge>
          )}
        </div>
      </div>
      <SearchableSelect
        options={holdings.map((h) => ({
          value: h.id,
          label: `${h.code} ${h.name || h.code}`,
          searchText: `${h.code} ${h.name || h.code}`.toLowerCase(),
        }))}
        value={fund.id}
        onValueChange={handleSwitchFund}
        placeholder="搜基金代码/名称..."
        className="w-[220px] sm:w-[280px] shrink-0"
      />
    </div>
  );
}
