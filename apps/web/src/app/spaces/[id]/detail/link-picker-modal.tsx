"use client";

import { createPortal } from "react-dom";
import { Dismissable } from "@/components/dismissable";
import { dueTag } from "@/components/todo-bits";
import type { TodoItem } from "@/lib/types";
import type { TodoActions } from "./use-todo-actions";

/** 「关联已有 TODO/行动」浮层（自 detail.tsx 拆出；桌面居中 / 移动端底部弹层） */
export default function LinkPickerModal(opts: {
  open: boolean;
  items: TodoItem[];
  actions: TodoActions;
}) {
  const { open, items: linkItems, actions } = opts;
  const { linkQuery, setLinkQuery, linkExisting, setLinkOpen } = actions;
  if (!open) return null;
  return createPortal(
    <Dismissable
      onClose={() => setLinkOpen(false)}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-80 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-3"
    >
      {(() => {
        const q = linkQuery.trim().toLowerCase();
        const shown = linkItems.filter((t) => !q || t.title.toLowerCase().includes(q));
        return (
          <>
            <p className="mb-2 flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-ink">关联已有 TODO / 行动</span>
              <span className="text-[10px] tabular-nums text-ink-faint">{linkItems.length} 条未关联</span>
            </p>
            <input
              autoFocus
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="搜索标题…"
              className="mb-2 w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-sky-500"
            />
            <div className="max-h-[46dvh] space-y-0.5 overflow-y-auto sm:max-h-72">
              {shown.map((t) => {
                const tag = dueTag(t.due_at);
                return (
                  <button
                    key={t.id}
                    onClick={() => void linkExisting(t.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
                  >
                    <span className="w-5 shrink-0 text-center text-sm leading-none">{t.is_important ? "⭐" : "○"}</span>
                    <span className="min-w-0 flex-1 truncate" title={t.title}>
                      {t.kind === "action" && (
                        <span className="mr-1 inline-flex items-center rounded bg-slate-500/15 px-1 py-0.5 align-middle text-[10px] text-ink-dim">
                          行动
                        </span>
                      )}
                      {t.title}
                    </span>
                    {tag && <span className={`shrink-0 text-[10px] ${tag.cls}`}>{tag.text}</span>}
                  </button>
                );
              })}
              {shown.length === 0 && (
                <p className="px-2 py-6 text-center text-[11px] text-ink-faint">
                  {linkItems.length === 0
                    ? "没有未关联的 TODO/行动 —— 顶层条目都已归属空间"
                    : "没有匹配的 TODO/行动"}
                </p>
              )}
            </div>
            <button
              onClick={() => setLinkOpen(false)}
              className="mt-2 w-full rounded-lg border border-line-soft py-1.5 text-[11px] text-ink-mute transition hover:bg-soft"
            >
              关闭
            </button>
          </>
        );
      })()}
    </Dismissable>,
    document.body,
  );
}
