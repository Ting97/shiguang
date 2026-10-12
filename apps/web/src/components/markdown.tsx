"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * AI 回复 Markdown 渲染（REQ-015）：react-markdown + remark-gfm。
 * 默认不渲染原始 HTML（XSS 安全）；元素经 components 映射到全站设计令牌，
 * 聊天气泡内排版（text-sm 基准：紧凑标题/列表/表格，浅色描边代码块）。
 */
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="mb-1.5 mt-2 text-base font-semibold first:mt-0" {...p} />,
          h2: (p) => <h3 className="mb-1.5 mt-2 text-base font-semibold first:mt-0" {...p} />,
          h3: (p) => <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0" {...p} />,
          h4: (p) => <h5 className="mb-1 mt-1.5 text-sm font-medium first:mt-0" {...p} />,
          p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
          strong: (p) => <strong className="font-semibold text-ink" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          del: (p) => <del className="text-ink-faint" {...p} />,
          a: (p) => <a className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
          ul: (p) => <ul className="my-1.5 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...p} />,
          ol: (p) => <ol className="my-1.5 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...p} />,
          li: (p) => <li className="pl-0.5 marker:text-ink-faint" {...p} />,
          blockquote: (p) => <blockquote className="my-1.5 border-l-2 border-line-soft pl-2.5 text-ink-mute" {...p} />,
          hr: () => <hr className="my-2.5 border-line-soft" />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg bg-wash px-3 py-2 font-mono text-xs" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-wash px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
                {children}
              </code>
            );
          },
          pre: (p) => <pre className="my-1.5 first:mt-0 last:mb-0" {...p} />,
          table: (p) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-wash" {...p} />,
          th: (p) => <th className="border border-line-soft px-2 py-1 text-left font-medium" {...p} />,
          td: (p) => <td className="border border-line-soft px-2 py-1 align-top" {...p} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
