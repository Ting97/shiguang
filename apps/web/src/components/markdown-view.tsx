"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 全站 markdown 渲染单件（感悟列表展开/预览，后续复盘/手册可复用）：
 * - remark-gfm：删除线/任务列表/表格/自动链接
 * - react-markdown 默认不渲染裸 HTML（防 XSS），链接统一新窗 + rel 防钓鱼
 * - 排版对齐全站 ink 色系；代码块/表格移动端 overflow-x 横滚
 */
export default function MarkdownView({ value }: { value: string }) {
  return (
    <div className="md-view min-w-0 text-xs leading-relaxed text-ink-soft">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2" />,
          h1: (p) => <h2 {...p} className="mt-3 mb-1 text-sm font-semibold text-ink" />,
          h2: (p) => <h3 {...p} className="mt-3 mb-1 text-sm font-semibold text-ink" />,
          h3: (p) => <h4 {...p} className="mt-2 mb-1 text-xs font-semibold text-ink" />,
          p: (p) => <p {...p} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0" />,
          ul: (p) => <ul {...p} className="my-1.5 list-disc space-y-0.5 pl-5" />,
          ol: (p) => <ol {...p} className="my-1.5 list-decimal space-y-0.5 pl-5" />,
          blockquote: (p) => <blockquote {...p} className="my-1.5 border-l-2 border-line-strong pl-3 text-ink-mute" />,
          code: (p) =>
            String(p.className ?? "").includes("language-") ? (
              <code {...p} className="block overflow-x-auto rounded-lg bg-elevated p-2.5 text-micro leading-relaxed text-ink-soft" />
            ) : (
              <code {...p} className="rounded bg-elevated px-1 py-0.5 text-micro text-ink" />
            ),
          pre: (p) => <pre {...p} className="my-1.5 overflow-x-auto" />,
          table: (p) => (
            <div className="my-1.5 overflow-x-auto">
              <table {...p} className="w-full border-collapse text-micro" />
            </div>
          ),
          th: (p) => <th {...p} className="border border-line-soft bg-elevated px-2 py-1 text-left font-medium text-ink" />,
          td: (p) => <td {...p} className="border border-line-soft px-2 py-1" />,
          hr: (p) => <hr {...p} className="my-2 border-line-soft" />,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
