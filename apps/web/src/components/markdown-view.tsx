"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 全站 markdown 渲染单件（感悟预览/编辑、拾光助手回复，后续复盘/手册可复用）：
 * - remark-gfm：删除线/任务列表/表格/自动链接
 * - react-markdown 默认不渲染裸 HTML（防 XSS），链接统一新窗 + rel 防钓鱼
 * - 排版对齐全站 ink 色系；代码块/表格移动端 overflow-x 横滚
 * - size：xs=感悟等紧凑正文（默认）；sm=对话气泡（助手回复，标题/代码/表格整体放大一档）
 * - memo：消息流/感悟列表重渲染时不重复解析 markdown
 */
type Size = "xs" | "sm";

const SIZE = {
  xs: {
    root: "text-xs leading-relaxed text-ink-soft",
    h1: "mt-3 mb-1 text-sm font-semibold text-ink first:mt-0",
    h2: "mt-3 mb-1 text-sm font-semibold text-ink first:mt-0",
    h3: "mt-2 mb-1 text-xs font-semibold text-ink first:mt-0",
    h4: "mt-2 mb-1 text-xs font-medium text-ink first:mt-0",
    list: "my-1.5 space-y-0.5 pl-5 first:mt-0 last:mb-0",
    codeBlock: "block overflow-x-auto rounded-lg bg-elevated p-2.5 text-micro leading-relaxed text-ink-soft",
    codeInline: "rounded bg-elevated px-1 py-0.5 text-micro text-ink",
    table: "w-full border-collapse text-micro",
  },
  sm: {
    root: "text-sm leading-relaxed text-ink",
    h1: "mt-2 mb-1.5 text-base font-semibold first:mt-0",
    h2: "mt-2 mb-1.5 text-base font-semibold first:mt-0",
    h3: "mt-2 mb-1 text-sm font-semibold first:mt-0",
    h4: "mt-1.5 mb-1 text-sm font-medium first:mt-0",
    list: "my-1.5 space-y-1 pl-5 first:mt-0 last:mb-0",
    codeBlock: "block overflow-x-auto rounded-lg bg-elevated px-3 py-2 font-mono text-xs",
    codeInline: "rounded bg-elevated px-1 py-0.5 font-mono text-[0.85em]",
    table: "w-full border-collapse text-xs",
  },
} as const satisfies Record<Size, Record<string, string>>;

const MarkdownView = memo(function MarkdownView({ value, size = "xs" }: { value: string; size?: Size }) {
  const s = SIZE[size];
  return (
    <div className={`min-w-0 ${s.root}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2" />,
          h1: (p) => <h2 {...p} className={s.h1} />,
          h2: (p) => <h3 {...p} className={s.h2} />,
          h3: (p) => <h4 {...p} className={s.h3} />,
          h4: (p) => <h5 {...p} className={s.h4} />,
          // pre-wrap：用户手写感悟的单换行保留；AI 回复的「结论/依据」换行同样受益
          p: (p) => <p {...p} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0" />,
          strong: (p) => <strong {...p} className="font-semibold text-ink" />,
          em: (p) => <em {...p} className="italic" />,
          del: (p) => <del {...p} className="text-ink-faint" />,
          ul: (p) => <ul {...p} className={`list-disc ${s.list}`} />,
          ol: (p) => <ol {...p} className={`list-decimal ${s.list}`} />,
          li: (p) => <li {...p} className="pl-0.5 marker:text-ink-faint" />,
          blockquote: (p) => <blockquote {...p} className="my-1.5 border-l-2 border-line-strong pl-3 text-ink-mute" />,
          code: (p) =>
            String(p.className ?? "").includes("language-") ? (
              <code {...p} className={s.codeBlock} />
            ) : (
              <code {...p} className={s.codeInline} />
            ),
          pre: (p) => <pre {...p} className="my-1.5 overflow-x-auto first:mt-0 last:mb-0" />,
          table: (p) => (
            <div className="my-1.5 overflow-x-auto">
              <table {...p} className={s.table} />
            </div>
          ),
          th: (p) => <th {...p} className="border border-line-soft bg-elevated px-2 py-1 text-left font-medium text-ink" />,
          td: (p) => <td {...p} className="border border-line-soft px-2 py-1 align-top" />,
          hr: (p) => <hr {...p} className="my-2 border-line-soft" />,
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownView;
