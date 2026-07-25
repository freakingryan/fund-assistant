import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Download } from "lucide-react";
import Markdown from "@/components/ui/Markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 弹窗标题 */
  title?: string;
  /** Markdown 源文本 */
  content: string;
  /** 导出文件名（不含扩展名） */
  fileName?: string;
}

/**
 * Markdown 放大弹窗：大屏展示 AI 分析结果，支持滚动、复制原始 Markdown、导出 .md 文件。
 */
export default function MarkdownModal({
  open,
  onOpenChange,
  title = "分析详情",
  content,
  fileName = "analysis",
}: Props) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleExport = React.useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, fileName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] flex h-[82vh] w-[92vw] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="m-0 flex-row items-center justify-between gap-2 border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <div className="flex items-center gap-1.5 pr-8">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!content}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1 text-green-500" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  复制
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!content}
              onClick={handleExport}
            >
              <Download className="h-3 w-3 mr-1" />
              导出
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <Markdown>{content}</Markdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
