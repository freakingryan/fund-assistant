import { Plus, Loader2, Wand2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEtfMapping } from "@/hooks/useEtfMappingController";

export function EtfMappingToolbar() {
  const {
    unmappedCount,
    batchRunning,
    batchProgress,
    handleBatchResolve,
    detecting,
    detectProgress,
    etfMappingCount,
    handleDetect,
    recommending,
    recProgress,
    handleAiFix,
    health,
    openAdd,
  } = useEtfMapping();

  const aiFixDisabled =
    recommending || detecting || (health ? health.filter((h) => !h.ok).length === 0 : true);

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h3 className="text-base font-semibold">场内 ETF 映射</h3>
        <p className="text-xs text-muted-foreground">
          所有持仓的场外基金 → 场内 ETF 对应关系（共 {etfMappingCount} 项，{unmappedCount}{" "}
          项未映射）
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          variant="outline"
          onClick={handleBatchResolve}
          disabled={batchRunning || unmappedCount === 0}
        >
          {batchRunning ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              补全中 {batchProgress.done}/{batchProgress.total}
            </>
          ) : (
            <>
              <Wand2 className="h-3 w-3 mr-1" />
              批量补全未映射{unmappedCount > 0 ? ` (${unmappedCount})` : ""}
            </>
          )}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          variant="outline"
          onClick={handleDetect}
          disabled={detecting || etfMappingCount === 0}
        >
          {detecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              检测中 {detectProgress.done}/{detectProgress.total}
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3 mr-1" />
              检测错误映射
            </>
          )}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          variant="outline"
          onClick={handleAiFix}
          disabled={aiFixDisabled}
        >
          {recommending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              推荐中 {recProgress.done}/{recProgress.total}
            </>
          ) : (
            <>
              <Wand2 className="h-3 w-3 mr-1" />
              AI 推荐修复
            </>
          )}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={openAdd}>
          <Plus className="h-3 w-3 mr-1" />
          新增映射
        </Button>
      </div>
    </div>
  );
}
