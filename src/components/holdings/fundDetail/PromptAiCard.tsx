import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Markdown from "@/components/ui/Markdown";
import MarkdownModal from "@/components/ui/MarkdownModal";
import { Sparkles, Copy, CheckCircle, FileText, Maximize2, Loader2, Layers, X } from "lucide-react";
import { useFundDetail, TEMPLATE_HINTS } from "@/hooks/useFundDetailController";
import {
  STRATEGY_GROUPS,
  STRATEGY_CATEGORY_LABELS,
  STRATEGY_DATA_LABELS,
} from "@/services/analysisStrategies";

/** 分析 Prompt 生成 / 直接调用 AI：消费详情控制器，依赖 prompt/ai 状态与 handler */
export default function PromptAiCard() {
  const {
    fund,
    templateType,
    setTemplateType,
    activeTab,
    setActiveTab,
    prompt,
    aiResponse,
    setAiResponse,
    aiLoading,
    aiError,
    setAiError,
    aiExpanded,
    setAiExpanded,
    aiConfigured,
    copied,
    quotesLoading,
    handleGenerate,
    handleCallAI,
    handleCopy,
    selectedStrategyIds,
    toggleStrategy,
    clearStrategies,
  } = useFundDetail();
  if (!fund) return null;

  const strategyGroups = STRATEGY_GROUPS;

  return (
    <Card className="flex-1">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">分析 Prompt / AI 调用</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            disabled={activeTab === "ai" ? !aiResponse : !prompt}
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                已复制
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                复制
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 模板选择（两类输出共用） */}
        <div className="flex gap-1">
          {(["diagnostic", "rebalance", "kline_enhanced"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTemplateType(t);
                setAiResponse("");
                setAiError(null);
              }}
              title={TEMPLATE_HINTS[t]}
              className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                templateType === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70"
              }`}
            >
              {t === "diagnostic" ? "诊断" : t === "rebalance" ? "调仓" : "K线"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {TEMPLATE_HINTS[templateType]}
        </p>

        {/* 分析策略多选（P0-A 多策略问股）：作为加性透镜追加到生成的 Prompt */}
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium flex items-center gap-1 text-foreground/80">
              <Layers className="h-3 w-3" />
              分析策略
              {selectedStrategyIds.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                  已选 {selectedStrategyIds.length}
                </span>
              )}
            </span>
            {selectedStrategyIds.length > 0 && (
              <button
                onClick={clearStrategies}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
              >
                <X className="h-2.5 w-2.5" />
                清空
              </button>
            )}
          </div>
          <div
            role="group"
            aria-label="分析策略（可多选叠加为透镜）"
            className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1"
          >
            {(Object.keys(strategyGroups) as Array<keyof typeof strategyGroups>).map((cat) => {
              const list = strategyGroups[cat];
              if (list.length === 0) return null;
              return (
                <div key={cat} className="flex flex-wrap items-center gap-1">
                  <span className="text-[9px] text-muted-foreground w-6 shrink-0 select-none">
                    {STRATEGY_CATEGORY_LABELS[cat]}
                  </span>
                  {list.map((s) => {
                    const active = selectedStrategyIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleStrategy(s.id)}
                        aria-pressed={active}
                        title={`${s.description}${s.requiredData.length ? `\n依赖数据：${s.requiredData.map((d) => STRATEGY_DATA_LABELS[d]).join("、")}` : ""}`}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                          active
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {s.displayName}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {selectedStrategyIds.length > 0 && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              选中的 {selectedStrategyIds.length} 个策略会作为额外分析视角写入 Prompt。
            </p>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "prompt" | "ai")}>
          <TabsList className="w-full">
            <TabsTrigger value="prompt" className="flex-1">
              生成 Prompt
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="flex-1"
              disabled={!aiConfigured}
              title={
                aiConfigured
                  ? "调用已配置的 AI 平台并返回回复"
                  : "请先在设置页配置 AI 平台（设置 → AI 平台）"
              }
            >
              直接调用 AI{!aiConfigured && "（未配置）"}
            </TabsTrigger>
          </TabsList>

          {/* 生成 Prompt */}
          <TabsContent value="prompt" className="space-y-2">
            <Button size="sm" className="w-full" disabled={quotesLoading} onClick={handleGenerate}>
              <Sparkles className="h-3 w-3 mr-1" />
              生成分析 Prompt
            </Button>
            {prompt ? (
              <Textarea
                value={prompt}
                readOnly
                className="min-h-[200px] text-xs font-mono leading-relaxed"
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">点击「生成分析 Prompt」创建分析 Prompt</p>
              </div>
            )}
          </TabsContent>

          {/* 直接调用 AI */}
          <TabsContent value="ai" className="space-y-2">
            <Button size="sm" className="w-full" disabled={aiLoading} onClick={handleCallAI}>
              <Sparkles className="h-3 w-3 mr-1" />
              {aiLoading ? "AI 分析中…" : "调用 AI 分析"}
            </Button>
            {aiLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {aiError && <p className="text-[11px] text-destructive leading-relaxed">⚠ {aiError}</p>}
            {aiResponse ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">AI 分析回复</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setAiExpanded(true)}
                  >
                    <Maximize2 className="h-3 w-3 mr-1" />
                    放大
                  </Button>
                </div>
                <div className="min-h-[200px] max-h-[480px] overflow-y-auto rounded-md border border-border bg-background/40 p-3">
                  <Markdown>{aiResponse}</Markdown>
                </div>
              </div>
            ) : !aiLoading && !aiError ? (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">先生成 Prompt，再点击「调用 AI 分析」</p>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
        <MarkdownModal
          open={aiExpanded}
          onOpenChange={setAiExpanded}
          title={`${fund?.name ?? "基金"} · AI 分析`}
          content={aiResponse}
          fileName={`${fund?.code ?? "fund"}-ai-analysis`}
        />
      </CardContent>
    </Card>
  );
}
