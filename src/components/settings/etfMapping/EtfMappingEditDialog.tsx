import { Search, RefreshCw, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useEtfMapping } from "@/hooks/useEtfMappingController";

export function EtfMappingEditDialog() {
  const {
    open,
    editIndex,
    draft,
    searching,
    candidates,
    setDraft,
    handleSearch,
    handleAutoMatch,
    pickCandidate,
    handleSave,
    closeDialog,
  } = useEtfMapping();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeDialog();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editIndex === null ? "新增 ETF 映射" : "编辑 ETF 映射"}</DialogTitle>
          <DialogDescription>填写场外基金与其对应的场内 ETF 代码</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">场外基金代码 *</Label>
              <Input
                value={draft.otcCode}
                onChange={(e) => setDraft((d) => ({ ...d, otcCode: e.target.value }))}
                placeholder="如 023765"
                className="text-xs font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">场外基金名称</Label>
              <Input
                value={draft.otcName}
                onChange={(e) => setDraft((d) => ({ ...d, otcName: e.target.value }))}
                placeholder="如 华夏中证5G通信主题ETF联接D"
                className="text-xs h-8"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">场内 ETF 代码 *</Label>
              <Input
                value={draft.exchangeCode}
                onChange={(e) => setDraft((d) => ({ ...d, exchangeCode: e.target.value }))}
                placeholder="如 515050"
                className="text-xs font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">场内 ETF 名称</Label>
              <Input
                value={draft.exchangeName}
                onChange={(e) => setDraft((d) => ({ ...d, exchangeName: e.target.value }))}
                placeholder="如 通信ETF华夏"
                className="text-xs h-8"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={handleSearch}
              disabled={searching}
            >
              {searching ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Search className="h-3 w-3 mr-1" />
              )}
              搜索场内ETF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={handleAutoMatch}
              disabled={searching}
            >
              {searching ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              自动匹配
            </Button>
          </div>

          {candidates.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-auto">
              <p className="text-[10px] text-muted-foreground px-2 py-1">点击选择候选：</p>
              {candidates.map((c) => (
                <button
                  key={c.exchangeCode}
                  type="button"
                  onClick={() => pickCandidate(c)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 text-left"
                >
                  <span className="font-mono">{c.exchangeCode}</span>
                  <span className="truncate ml-2 flex-1">{c.exchangeName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={closeDialog}>
            <X className="h-3 w-3 mr-1" />
            取消
          </Button>
          <Button size="sm" onClick={handleSave}>
            {editIndex === null ? "新增" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
