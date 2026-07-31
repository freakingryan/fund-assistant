/**
 * 设置 · ima 知识库取数源配置（观点回测的入口配置）
 *
 * 解决交接文档 §3 #1 阻塞项：`settings.ima` 此前只有读、没有写入口，
 * 用户无法填 clientId / apiKey / kbId，观点回测功能实际用不起来。
 *
 * 设计：
 *  - BYOK：密钥只存本地 IndexedDB（与 AI key 同待遇），不出浏览器、不上传任何服务端。
 *  - 「测试连接」接 `probeConnection()`（此前已实现但零调用方）。
 *  - 「拉取知识库」接 `listKnowledgeBases()`，避免用户手抄不透明的 kbId。
 *  - CORS 兜底：可选 proxyUrl，代理只转发不持密钥。
 *
 * @module components/settings/ImaConfigCard
 */

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useSettingsStore } from "@/stores/settings";
import { probeConnection, listKnowledgeBases, ImaError } from "@/services/ima";
import type { ImaKnowledgeBase } from "@/services/ima";

export default function ImaConfigCard() {
  const ima = useSettingsStore((s) => s.settings.ima);
  const updateIma = useSettingsStore((s) => s.updateIma);

  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loadingKb, setLoadingKb] = useState(false);
  const [kbList, setKbList] = useState<ImaKnowledgeBase[]>([]);
  const [showKey, setShowKey] = useState(false);

  const hasCreds = !!ima.clientId && !!ima.apiKey;
  const disabled = !ima.enabled;

  const handleTest = async () => {
    setTesting(true);
    setProbe(null);
    const r = await probeConnection(ima);
    setProbe({ ok: r.ok, msg: r.message });
    toast({ type: r.ok ? "success" : "error", message: r.message });
    setTesting(false);
  };

  const handleLoadKb = async () => {
    setLoadingKb(true);
    try {
      const list = await listKnowledgeBases(ima);
      setKbList(list);
      toast({
        type: list.length > 0 ? "success" : "warning",
        message:
          list.length > 0
            ? `已拉取 ${list.length} 个知识库，请在下拉中选择`
            : "未拉到知识库列表（返回结构可能不同），请手动填写知识库 ID",
      });
    } catch (e) {
      toast({
        type: "error",
        message: e instanceof ImaError ? e.message : `拉取失败：${String(e)}`,
      });
    } finally {
      setLoadingKb(false);
    }
  };

  const handleClearCreds = async () => {
    await updateIma({ clientId: "", apiKey: "" });
    setProbe(null);
    setKbList([]);
    toast({ type: "success", message: "已清除本地保存的 ima 密钥" });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              ima 知识库（观点回测取数源）
            </CardTitle>
            <CardDescription>
              从 ima 知识库同步已保存的投资意见，或用 ima 抓取公众号 / 网页正文
            </CardDescription>
          </div>
          <Switch checked={ima.enabled} onCheckedChange={(v) => void updateIma({ enabled: v })} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          默认关闭。ima 在本功能里<strong>只当取数源</strong>，不做生成式分析、不碰你的笔记。
          <br />
          <strong>前提</strong>：ima OpenAPI 读不到会话历史，只能读知识库——你需要先在 ima
          侧把「结合市场分析后的投资意见」对话<strong>保存到知识库</strong>，这里才同步得到东西。
          <br />
          密钥在 <code className="text-[10px]">ima.qq.com</code> 的开放接口页生成，
          <strong>约 1 个月有效期</strong>，过期后需回来重填。密钥仅存本浏览器
          IndexedDB，不会上传任何服务端。
        </p>

        {/* 凭证 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">clientId</Label>
            <Input
              placeholder="ima-openapi-clientid"
              value={ima.clientId}
              disabled={disabled}
              onChange={(e) => void updateIma({ clientId: e.target.value.trim() })}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              apiKey
              {ima.apiKey && <span className="w-2 h-2 rounded-full bg-green-500" title="已配置" />}
            </Label>
            <div className="flex gap-1.5">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="ima-openapi-apikey"
                value={ima.apiKey}
                disabled={disabled}
                onChange={(e) => void updateIma({ apiKey: e.target.value.trim() })}
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title={showKey ? "隐藏" : "显示"}
                disabled={disabled || !ima.apiKey}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* 知识库定位 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">知识库 ID（kbId）</Label>
            <div className="flex gap-1.5">
              <Input
                placeholder="投资观点知识库的 ID"
                value={ima.kbId}
                disabled={disabled}
                onChange={(e) => void updateIma({ kbId: e.target.value.trim() })}
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="拉取我的知识库列表"
                disabled={disabled || !hasCreds || loadingKb}
                onClick={handleLoadKb}
              >
                {loadingKb ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {kbList.length > 0 && (
              <Select value={ima.kbId} onValueChange={(v) => void updateIma({ kbId: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="从拉取到的知识库中选择" />
                </SelectTrigger>
                <SelectContent>
                  {kbList.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">文件夹 ID（kbFolderId，可选）</Label>
            <Input
              placeholder="留空=同步整个知识库"
              value={ima.kbFolderId}
              disabled={disabled}
              onChange={(e) => void updateIma({ kbFolderId: e.target.value.trim() })}
              className="h-8 text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              同步可留空；但「用 ima 抓取链接」走的 import_urls 接口要求文件夹 ID 必填。
            </p>
          </div>
        </div>

        {/* CORS 代理 */}
        <div className="space-y-1.5">
          <Label className="text-xs">CORS 代理地址（proxyUrl，可选）</Label>
          <Input
            placeholder="https://your-worker.workers.dev（留空=浏览器直连 ima）"
            value={ima.proxyUrl}
            disabled={disabled}
            onChange={(e) => void updateIma({ proxyUrl: e.target.value.trim() })}
            className="h-8 text-xs font-mono"
          />
          <p className="text-[10px] text-muted-foreground">
            仅当浏览器直连 ima 被 CORS 拦截时才需要。代理契约：POST{" "}
            <code>{`{ url, method, headers, body }`}</code>，代理据此转发上游并回传响应 ——
            <strong>只补 CORS、不持密钥</strong>（密钥始终由你的浏览器发出）。
          </p>
        </div>

        {/* 操作 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={disabled || !hasCreds || testing}
            onClick={handleTest}
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
            )}
            测试连接
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
            disabled={!ima.clientId && !ima.apiKey}
            onClick={handleClearCreds}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            清除密钥
          </Button>
          {probe && (
            <span
              className={`flex items-center gap-1 text-xs ${
                probe.ok ? "text-green-600" : "text-destructive"
              }`}
            >
              {probe.ok ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              {probe.msg}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
