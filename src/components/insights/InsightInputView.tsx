/**
 * 观点回测 · 录入视图（编排中枢）
 *
 * 三种输入：
 *  1. 「从 ima 同步」（首选）：syncFromImaKb 拉回已存知识库的投资意见 → extractDirections(Case A) → 存 Insight。
 *     前提：用户须在 ima 侧把对话「保存到知识库」的指定 KB/文件夹。
 *  2. 文本 · ima 已分析（Case A）：贴 ima 分析结论 → 轻量方向抽取（不重跑 AI）。
 *  3. 文本 · 原始观点（Case B）：贴原始观点 → analyzeInsight 跑 callAI 完整抽取。
 *  4. 链接 · ima 抓取：填 URL → fetchArticle(ima) 取回正文 → 作原始观点跑 Case B。
 *
 * 公共：录入时自动 buildMarketSnapshot(当日宽基+相关ETF) 随记录持久化（回看可复现「当日市场动向」）。
 *
 * @module components/insights/InsightInputView
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Brain, Link2, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useSettingsStore } from "@/stores/settings";
import { db } from "@/stores/db";
import { syncFromImaKb, fetchArticle, ImaError } from "@/services/ima";
import { buildMarketSnapshot } from "@/services/insightMarket";
import { extractDirections, analyzeInsight } from "@/services/insightAnalysis";
import { formatDateOnly } from "@/lib/dataTime";
import { ROUTES } from "@/constants/routes";
import type { Insight, InvestmentDirection, MarketSnapshot, ThemeMapping } from "@/types";

function todayStr(): string {
  return formatDateOnly(Date.now());
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ins_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** 把 ima 错误码转成中文引导 */
function imaHint(e: unknown): string {
  if (e instanceof ImaError) {
    if (e.code === "auth") return "ima 密钥无效或已过期（约 1 月有效期），请到设置页重新生成。";
    if (e.code === "network") return "网络/CORS 失败：请在设置中配置 proxyUrl 代理，或检查网络。";
    if (e.code === "notfound") return e.message;
  }
  return e instanceof Error ? e.message : "未知错误";
}

export default function InsightInputView() {
  const navigate = useNavigate();
  const ima = useSettingsStore((s) => s.settings.ima);

  const [date, setDate] = useState<string>(todayStr());
  const [blogger, setBlogger] = useState<string>("");
  const [mode, setMode] = useState<"ima-analyzed" | "raw-text">("ima-analyzed");
  const [fetchByIma, setFetchByIma] = useState<boolean>(false);
  const [url, setUrl] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [busyLabel, setBusyLabel] = useState<string>("");

  const run = useCallback(async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    setBusyLabel(label);
    try {
      await fn();
    } catch (e) {
      toast({ type: "error", message: imaHint(e) });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, []);

  /** 把一条文本（已分析或原始）按 mode 抽成方向卡片并落库 */
  const saveInsight = useCallback(
    async (opts: {
      fullText: string;
      sourceType: "text" | "url" | "ima";
      recordMode: "ima-analyzed" | "raw-text";
      url?: string;
    }) => {
      const mappings = (await db.themeMappings.toArray()) as ThemeMapping[];
      const snapshot: MarketSnapshot = await buildMarketSnapshot(date, mappings);
      let directions: InvestmentDirection[];
      let aiAdvice: string | undefined;
      if (opts.recordMode === "ima-analyzed") {
        directions = extractDirections(opts.fullText, mappings);
      } else {
        const r = await analyzeInsight(opts.fullText, snapshot, mappings);
        directions = r.directions;
        aiAdvice = r.advice;
      }
      const insight: Insight = {
        id: newId(),
        date,
        createdAt: Date.now(),
        mode: opts.recordMode,
        sourceType: opts.sourceType,
        url: opts.url,
        blogger: blogger.trim() || undefined,
        fullText: opts.fullText,
        directions,
        marketSnapshot: snapshot,
        aiAdvice,
      };
      await db.insights.add(insight);
      return directions.length;
    },
    [date, blogger],
  );

  /** 从 ima 知识库同步（首选路径） */
  const handleImaSync = useCallback(() => {
    void run(async () => {
      if (!ima.enabled) {
        toast({ type: "warning", message: "请先在设置中启用并填写 ima 配置。" });
        return;
      }
      const items = await syncFromImaKb(ima);
      if (items.length === 0) {
        toast({
          type: "info",
          message: "知识库中没有可取回的投资意见（请确认已把对话保存到该知识库）。",
        });
        return;
      }
      const mappings = (await db.themeMappings.toArray()) as ThemeMapping[];
      let saved = 0;
      for (const it of items) {
        const itemDate = it.createdAt ? formatDateOnly(it.createdAt) : todayStr();
        const snapshot = await buildMarketSnapshot(itemDate, mappings);
        const directions = extractDirections(it.text, mappings);
        if (directions.length === 0) continue;
        await db.insights.add({
          id: newId(),
          date: itemDate,
          createdAt: it.createdAt ?? Date.now(),
          mode: "ima-analyzed",
          sourceType: "ima",
          blogger: it.title || undefined,
          fullText: it.text,
          directions,
          marketSnapshot: snapshot,
        });
        saved++;
      }
      toast({ type: "success", message: `已从 ima 知识库同步 ${saved} 条投资意见。` });
      navigate("/insights/timeline");
    }, "正在从 ima 知识库同步…");
  }, [ima, run, navigate]);

  /** 本地录入：文本 / 链接 */
  const handleAnalyze = useCallback(() => {
    void run(async () => {
      let fullText = text;
      let sourceType: "text" | "url" = "text";
      let recordMode = mode;

      // 链接模式：先经 ima 抓取正文
      if (fetchByIma && url.trim()) {
        if (!ima.enabled) {
          toast({ type: "warning", message: "使用 ima 抓取需先在设置中启用并填写 ima 配置。" });
          return;
        }
        const { markdown } = await fetchArticle(url.trim(), ima);
        fullText = markdown;
        sourceType = "url";
        recordMode = "raw-text"; // 抓回的是原始观点，跑完整分析
      }

      if (!fullText.trim()) {
        toast({ type: "warning", message: "请先粘贴内容或填写链接。" });
        return;
      }

      const n = await saveInsight({
        fullText,
        sourceType,
        recordMode,
        url: sourceType === "url" ? url.trim() : undefined,
      });
      toast({ type: "success", message: `已生成 ${n} 条投资方向并保存（${date}）。` });
      setText("");
      setUrl("");
    }, "正在分析与抓取市场快照…");
  }, [fetchByIma, url, text, mode, ima, run, saveInsight, date]);

  const requireIma = fetchByIma;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" /> 观点回测 · 录入
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          粘贴博主投资观点（或经 ima
          抓取公众号/网页），结合当日市场动向抽取结构化方向并保存，可回看与回测。
        </p>
      </div>

      {/* ima 同步（首选） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> 从 ima 知识库同步
          </CardTitle>
          <CardDescription>
            自动拉回你已「保存到知识库」的投资意见并整理。前提：在 ima
            侧把对话存到指定知识库（设置里填 kbId）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleImaSync} disabled={busy || !ima.enabled}>
            {busy && busyLabel.includes("ima") ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            从 ima 同步投资意见
          </Button>
          {!ima.enabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              未启用 ima：请到
              <Button
                variant="link"
                className="h-auto p-0 mx-1 text-xs align-baseline"
                onClick={() => navigate(ROUTES.settings)}
              >
                设置 → 数据源
              </Button>
              的「ima 知识库」卡片填写 clientId / apiKey / kbId 并启用。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 本地录入 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">粘贴观点 / 链接</CardTitle>
          <CardDescription>选择分析模式与来源，录入时自动抓取当日市场快照。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>观点日期</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>博主 / 来源（可选）</Label>
              <Input
                value={blogger}
                onChange={(e) => setBlogger(e.target.value)}
                placeholder="如：公众号 XX / 小红书 XX"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>分析模式</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "ima-analyzed" | "raw-text")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ima-analyzed">
                  文本 · ima 已分析（轻量抽取，不重跑 AI）
                </SelectItem>
                <SelectItem value="raw-text">文本 · 原始观点（AI 完整分析）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 链接抓取开关 */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">用 ima 抓取链接正文</p>
                <p className="text-xs text-muted-foreground">
                  填下方链接，经 ima 服务端抓取公众号/网页正文（需 ima 启用）。
                </p>
              </div>
            </div>
            <Switch checked={fetchByIma} onCheckedChange={setFetchByIma} disabled={!ima.enabled} />
          </div>

          {fetchByIma && (
            <div className="space-y-1.5">
              <Label>链接（公众号文章 / 网页）</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mp.weixin.qq.com/..."
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{fetchByIma ? "（抓取后自动填充，可在此校对）正文" : "观点正文"}</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                mode === "ima-analyzed"
                  ? "粘贴 ima 已分析的结论，例如：\n- **MLCC**：确定性最高，建议分批建仓。\n- **半导体材料设备**：底部横盘磨底，可逢低布局。"
                  : "粘贴博主原始观点文本，AI 将结合当日市场抽取投资方向并给出建议。"
              }
              className="min-h-[200px] font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleAnalyze} disabled={busy}>
              {busy && !busyLabel.includes("ima") ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {requireIma && url.trim() ? "抓取并分析" : "分析并保存"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/insights/timeline")}>
              查看时间线 <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
            <Badge variant="secondary">
              {mode === "ima-analyzed" ? "Case A · 轻量抽取" : "Case B · AI 分析"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
