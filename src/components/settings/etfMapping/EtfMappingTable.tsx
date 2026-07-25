import { Trash2, Pencil, RefreshCw, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEtfMapping, isActiveRow, EXCHANGE_ETF_PREFIX } from "@/hooks/useEtfMappingController";
import type { Row } from "@/hooks/useEtfMappingController";

function renderRow(
  r: Row,
  ctx: {
    brokenCodes: Set<string>;
    refreshing: number | null;
    handleRefresh: (i: number) => Promise<void>;
    openEdit: (i: number) => void;
    handleDelete: (i: number) => void;
    openAddFromHolding: (code: string, name: string) => void;
  },
) {
  const isEtf = r.kind !== "orphan" && EXCHANGE_ETF_PREFIX.test(r.code);
  const isMapped = !!r.mapping;
  const { brokenCodes, refreshing, handleRefresh, openEdit, handleDelete, openAddFromHolding } =
    ctx;
  return (
    <TableRow key={`${r.kind}-${r.code}`}>
      <TableCell className="text-xs font-mono">{r.code}</TableCell>
      <TableCell className="text-xs">{r.name}</TableCell>
      <TableCell className="text-xs">
        {r.kind === "orphan" ? (
          <Badge variant="outline" className="text-[10px]">
            映射(无持仓)
          </Badge>
        ) : isEtf ? (
          <Badge variant="outline" className="text-[10px]">
            场内ETF
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            场外基金
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs font-mono">{isMapped ? r.mapping.exchangeCode : "-"}</TableCell>
      <TableCell className="text-xs">{isMapped ? r.mapping.exchangeName : "-"}</TableCell>
      <TableCell>
        {isEtf ? (
          <Badge variant="secondary" className="text-[10px] text-muted-foreground">
            无需映射
          </Badge>
        ) : isMapped ? (
          brokenCodes.has(r.mapping.exchangeCode) ? (
            <Badge variant="destructive" className="text-[10px]">
              K线失败
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] text-green-600">
              已映射
            </Badge>
          )
        ) : (
          <Badge variant="destructive" className="text-[10px]">
            未映射
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {isEtf ? (
            <span className="text-[10px] text-muted-foreground">—</span>
          ) : isMapped ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="重新查询"
                disabled={refreshing === r.mappingIndex}
                onClick={() => r.mappingIndex !== null && handleRefresh(r.mappingIndex)}
              >
                {refreshing === r.mappingIndex ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="编辑"
                onClick={() => r.mappingIndex !== null && openEdit(r.mappingIndex)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="删除"
                onClick={() => r.mappingIndex !== null && handleDelete(r.mappingIndex)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => openAddFromHolding(r.code, r.name)}
            >
              <Plus className="h-3 w-3 mr-1" />
              添加映射
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function EtfMappingTable() {
  const {
    primaryRows,
    activeRows,
    brokenCodes,
    refreshing,
    handleRefresh,
    openEdit,
    handleDelete,
    openAddFromHolding,
  } = useEtfMapping();
  const isEmpty = primaryRows.length === 0 && activeRows.length === 0;

  if (isEmpty) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        暂无持仓，也无映射。导入持仓或新增基金会自动建立映射，也可在此手动添加。
      </p>
    );
  }

  const ctx = {
    brokenCodes,
    refreshing,
    handleRefresh,
    openEdit,
    handleDelete,
    openAddFromHolding,
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[88px]">代码</TableHead>
            <TableHead>名称</TableHead>
            <TableHead className="w-[78px]">类型</TableHead>
            <TableHead className="w-[88px]">场内ETF</TableHead>
            <TableHead>场内名称</TableHead>
            <TableHead className="w-[68px]">状态</TableHead>
            <TableHead className="w-[130px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {primaryRows.map((r) => renderRow(r, ctx))}
          {activeRows.length > 0 && (
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={7} className="py-1.5 text-center">
                <span className="text-[10px] text-muted-foreground">
                  以下为主动型 / 名称未含「ETF」「指数」的基金 · 不参与批量补全
                </span>
              </TableCell>
            </TableRow>
          )}
          {activeRows.map((r) => renderRow(r, ctx))}
        </TableBody>
      </Table>
    </div>
  );
}

// 供外部（如将来需要按行 memo 化）复用：判断某行是否为主动型
export { isActiveRow };
