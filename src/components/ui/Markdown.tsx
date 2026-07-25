import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * Markdown 渲染组件：将 LLM 返回的 Markdown 文本渲染为格式化文档。
 * 使用 react-markdown（不依赖 dangerouslySetInnerHTML），并针对应用主题做 Tailwind 样式适配。
 */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mt-3 mb-1.5 text-foreground leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mt-3 mb-1.5 text-foreground leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-medium mt-2.5 mb-1 text-foreground leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-semibold mt-2 mb-1 text-foreground">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-xs leading-relaxed my-1.5 text-foreground/90">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/80">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 my-1.5 space-y-0.5 text-xs text-foreground/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 my-1.5 space-y-0.5 text-xs text-foreground/90">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2.5 my-2 text-muted-foreground text-xs italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  code: ({ children, className }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return (
        <code className="block bg-muted text-foreground rounded-md p-2 my-2 text-[11px] font-mono whitespace-pre overflow-x-auto">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted text-foreground rounded px-1 py-0.5 text-[11px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-foreground/90 align-top">{children}</td>
  ),
};

interface Props {
  children: string;
  className?: string;
}

export default function Markdown({ children, className = "" }: Props) {
  return (
    <div className={`text-foreground ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
