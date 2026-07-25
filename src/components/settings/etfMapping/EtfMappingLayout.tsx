import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useEtfMapping } from "@/hooks/useEtfMappingController";
import { EtfMappingToolbar } from "./EtfMappingToolbar";
import { EtfMappingTable } from "./EtfMappingTable";
import { EtfMappingEditDialog } from "./EtfMappingEditDialog";
import { EtfMappingReviewDialog } from "./EtfMappingReviewDialog";

export function EtfMappingLayout() {
  const { health } = useEtfMapping();
  const hasBroken = !!health && health.some((h) => !h.ok);

  return (
    <Card>
      <CardHeader className="pb-3">
        <EtfMappingToolbar />
      </CardHeader>
      <CardContent>
        {hasBroken && (
          <div className="mb-3 flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              检测到 {health!.filter((h) => !h.ok).length} 条映射 K
              线取数失败（已在表格中红标「K线失败」）。 可点上方「AI
              推荐修复」生成修正建议，审阅后应用。
            </span>
          </div>
        )}
        <EtfMappingTable />
      </CardContent>

      <EtfMappingEditDialog />
      <EtfMappingReviewDialog />
    </Card>
  );
}
