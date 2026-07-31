/**
 * 设置 · 主题映射管理（观点回测的回测落点）
 *
 * 观点里的「主题」要能落到具体 ETF/指数代码，回测才跑得起来：
 * `insightAnalysis.resolveMappedCodes` 按 主题名 / 展示名 / 别名 命中文本后回填 codes，
 * 命中不到 → `mappedCodes` 为空 → 该方向在回测里只能标「取数缺口」。
 * 所以这张表是核心可配置项，需支持用户按自己的行业口径增删改。
 *
 * 存储：Dexie `db.themeMappings`（主键 id 即主题关键词）；首启由 db.ts 预置 9 类。
 *
 * @module components/settings/ThemeMappingManager
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RotateCcw, X, Tags } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { db, DEFAULT_THEME_MAPPINGS } from "@/stores/db";
import type { ThemeMapping } from "@/types";

interface Draft {
  id: string;
  label: string;
  aliases: string;
  codes: string;
}

const EMPTY_DRAFT: Draft = { id: "", label: "", aliases: "", codes: "" };

/** 逗号 / 顿号 / 空格 / 分号均可分隔，去空去重 */
function splitList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，、;；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function toDraft(m: ThemeMapping): Draft {
  return {
    id: m.id,
    label: m.label ?? "",
    aliases: (m.aliases ?? []).join("，"),
    codes: m.codes.join("，"),
  };
}

export default function ThemeMappingManager() {
  const [rows, setRows] = useState<ThemeMapping[]>([]);
  const [open, setOpen] = useState(false);
  /** null = 新增；否则为被编辑行的原始 id（id 可改，需迁移主键） */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const reload = useCallback(async () => {
    const list = await db.themeMappings.toArray();
    list.sort((a, b) => a.id.localeCompare(b.id, "zh-CN"));
    setRows(list);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载即读 IndexedDB，setRows 在 await 之后触发属预期
    void reload();
  }, [reload]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const openEdit = (m: ThemeMapping) => {
    setEditingId(m.id);
    setDraft(toDraft(m));
    setOpen(true);
  };

  const handleSave = async () => {
    const id = draft.id.trim();
    const codes = splitList(draft.codes);
    if (!id) {
      toast({ type: "warning", message: "请填写主题关键词" });
      return;
    }
    if (codes.length === 0) {
      toast({ type: "warning", message: "请至少填写一个标的代码（如 512480）" });
      return;
    }
    // 主键冲突检查：新增，或编辑时把 id 改成了别的已存在主题
    if (id !== editingId && rows.some((r) => r.id === id)) {
      toast({ type: "warning", message: `主题「${id}」已存在，请直接编辑该条` });
      return;
    }

    const next: ThemeMapping = {
      id,
      label: draft.label.trim() || undefined,
      codes,
      aliases: splitList(draft.aliases),
    };
    if (next.aliases && next.aliases.length === 0) delete next.aliases;

    // id 是主键，改名等于换行：先删旧再写新，避免残留孤儿记录
    if (editingId && editingId !== id) await db.themeMappings.delete(editingId);
    await db.themeMappings.put(next);

    setOpen(false);
    await reload();
    toast({ type: "success", message: editingId ? "主题映射已更新" : "主题映射已新增" });
  };

  const handleDelete = async (id: string) => {
    await db.themeMappings.delete(id);
    await reload();
    toast({ type: "success", message: `已删除主题「${id}」` });
  };

  /** 只补齐缺失的预置项，不覆盖用户已改过的同名主题 */
  const handleRestoreDefaults = async () => {
    const existing = new Set(rows.map((r) => r.id));
    const missing = DEFAULT_THEME_MAPPINGS.filter((m) => !existing.has(m.id));
    if (missing.length === 0) {
      toast({ type: "warning", message: "预置主题都在，无需恢复" });
      return;
    }
    await db.themeMappings.bulkAdd(missing);
    await reload();
    toast({ type: "success", message: `已补回 ${missing.length} 个预置主题（未覆盖你改过的）` });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-1.5">
              <Tags className="h-4 w-4 text-primary" />
              主题映射（观点回测落点）
            </CardTitle>
            <CardDescription>
              观点里的主题命中关键词后，回填这里配置的 ETF / 指数代码用于 T+5 回测
            </CardDescription>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleRestoreDefaults}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              恢复预置
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={openAdd}>
              <Plus className="h-3 w-3 mr-1" />
              新增主题
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
          博主用词常和主题名不一致（说「芯片」而不是「半导体」）—— 给主题补上<strong>别名</strong>
          能显著提升回测覆盖率，命中任一别名即回填该主题的标的。
        </p>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            暂无主题映射。点「恢复预置」载入 9 类常见主题，或「新增主题」自定义。
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">主题关键词</TableHead>
                  <TableHead className="w-[100px]">展示名</TableHead>
                  <TableHead>别名</TableHead>
                  <TableHead className="w-[170px]">标的代码</TableHead>
                  <TableHead className="w-[80px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs font-medium">{m.id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.label && m.label !== m.id ? m.label : "-"}
                    </TableCell>
                    <TableCell>
                      {m.aliases && m.aliases.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.aliases.map((a) => (
                            <Badge key={a} variant="secondary" className="text-[10px]">
                              {a}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">未设置</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{m.codes.join(" / ")}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="编辑"
                          onClick={() => openEdit(m)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <ConfirmAction
                          title={`删除主题「${m.id}」？`}
                          description="删除后，含该主题的观点将无法回填标的、回测会标为取数缺口。可随时重新添加。"
                          confirmText="删除"
                          onConfirm={() => void handleDelete(m.id)}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </ConfirmAction>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId === null ? "新增主题映射" : "编辑主题映射"}</DialogTitle>
            <DialogDescription>主题关键词用于文本命中，标的代码用于回测取数</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">主题关键词 *</Label>
                <Input
                  value={draft.id}
                  onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                  placeholder="如 半导体"
                  className="text-xs h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">展示名（可选）</Label>
                <Input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="缺省用主题关键词"
                  className="text-xs h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">别名（可选，逗号分隔）</Label>
              <Input
                value={draft.aliases}
                onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))}
                placeholder="如 芯片，集成电路，国产替代"
                className="text-xs h-8"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">标的代码 *（逗号分隔，ETF / 指数）</Label>
              <Input
                value={draft.codes}
                onChange={(e) => setDraft((d) => ({ ...d, codes: e.target.value }))}
                placeholder="如 512480，159995"
                className="text-xs font-mono h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                建议填流动性好的宽基 / 行业 ETF；多个代码回测时取等权平均收益。
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              <X className="h-3 w-3 mr-1" />
              取消
            </Button>
            <Button size="sm" onClick={() => void handleSave()}>
              {editingId === null ? "新增" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
