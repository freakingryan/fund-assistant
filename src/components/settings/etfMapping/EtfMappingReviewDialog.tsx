import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEtfMapping, ruleLabel } from "@/hooks/useEtfMappingController";

export function EtfMappingReviewDialog() {
  const {
    reviewOpen,
    recommendations,
    orderedRecs,
    editRecs,
    setEditRecs,
    appliedCodes,
    handleApplyRec,
    handleApplyAll,
    setReviewOpen,
  } = useEtfMapping();

  return (
    <Dialog
      open={reviewOpen}
      onOpenChange={(v) => {
        if (!v) setReviewOpen(false);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>AI 推荐修复 ETF 映射（请审阅后应用）</DialogTitle>
          <DialogDescription>
            以下为检测到的错误映射及 AI 推荐修正项（按 R1 同公司同指数 → R2 同指数跨公司 → R3
            仅主题相关 排序，并经 K 线端点验证）。 确认无误后点「应用」；可手动修改推荐代码/名称。
          </DialogDescription>
        </DialogHeader>

        {recommendations.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            AI 未给出任何推荐（可能所有错误项都未匹配到合适的场内 ETF）。可手动编辑映射。
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[64px]">场外码</TableHead>
                  <TableHead>场外名称</TableHead>
                  <TableHead className="w-[78px]">当前(错误)</TableHead>
                  <TableHead className="w-[104px]">推荐代码</TableHead>
                  <TableHead>推荐名称</TableHead>
                  <TableHead className="w-[96px]">规则/置信</TableHead>
                  <TableHead className="w-[64px]">验证</TableHead>
                  <TableHead className="w-[64px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedRecs.map((r) => {
                  const edit = editRecs[r.otcCode] || {
                    code: r.recommendedExchangeCode,
                    name: r.recommendedExchangeName,
                  };
                  return (
                    <TableRow key={r.otcCode}>
                      <TableCell className="text-xs font-mono">{r.otcCode}</TableCell>
                      <TableCell className="text-xs">{r.otcName}</TableCell>
                      <TableCell className="text-xs font-mono text-destructive">
                        {r.currentExchangeCode}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={edit.code}
                          onChange={(e) =>
                            setEditRecs((prev) => ({
                              ...prev,
                              [r.otcCode]: { ...edit, code: e.target.value },
                            }))
                          }
                          className="text-xs font-mono h-7 w-[92px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={edit.name}
                          onChange={(e) =>
                            setEditRecs((prev) => ({
                              ...prev,
                              [r.otcCode]: { ...edit, name: e.target.value },
                            }))
                          }
                          className="text-xs h-7"
                        />
                      </TableCell>
                      <TableCell className="text-[10px]">
                        <div>{ruleLabel(r.rule)}</div>
                        <div className="text-muted-foreground">
                          置信 {(r.confidence * 100).toFixed(0)}%
                        </div>
                        {r.reason && (
                          <div className="text-muted-foreground mt-0.5 max-w-[140px] leading-tight">
                            {r.reason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.verified ? (
                          <Badge variant="secondary" className="text-[10px] text-green-600">
                            已验证
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            未验证
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleApplyRec(r.otcCode)}
                          disabled={appliedCodes.has(r.otcCode)}
                        >
                          {appliedCodes.has(r.otcCode) ? "已应用" : "应用"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={() => setReviewOpen(false)}>
            <X className="h-3 w-3 mr-1" />
            取消
          </Button>
          <Button size="sm" onClick={handleApplyAll} disabled={recommendations.length === 0}>
            全部应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
