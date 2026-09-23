"use client";

import { createPortal } from "react-dom";
import { Dismissable } from "@/components/dismissable";
import type { MenuRowState, Pos } from "./types";
import type { TodoActions } from "./use-todo-actions";

/** 行操作菜单卡片（自 detail.tsx 拆出）：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层） */
export default function RowMenuModal(opts: {
  menuRow: MenuRowState;
  pos: Pos | null;
  actions: TodoActions;
}) {
  const { menuRow, pos, actions } = opts;
  const { busyId, setMenuRow, openNote, decompose, removeTodo, startEdit, setPickerRow } = actions;
  return createPortal(
    <Dismissable
      onClose={() => setMenuRow(null)}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
      <p className="mb-1.5 truncate px-1.5 text-[11px] font-medium text-ink-dim">{menuRow.todo.title}</p>
      <div className="space-y-0.5">
        {menuRow.isChild ? (
          <>
            <button
              onClick={() => { const c = menuRow.todo; setMenuRow(null); openNote(c); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
            >
              <span className="w-5 shrink-0 text-center text-sm leading-none">✏️</span>
              <span className="min-w-0 flex-1">编辑标题 / 描述</span>
            </button>
            {menuRow.todo.status !== "done" && (
              <button
                onClick={() => { setMenuRow(null); decompose({ id: menuRow.todo.id, title: menuRow.todo.title, isAction: true }); }}
                disabled={busyId === menuRow.todo.id}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash disabled:opacity-40"
              >
                <span className="w-5 shrink-0 text-center text-sm leading-none">{busyId === menuRow.todo.id ? "⏳" : "✨"}</span>
                <span className="min-w-0 flex-1">
                  AI 细化为更小行动
                  <span className="block truncate text-[10px] text-ink-faint">插入到该行动之后</span>
                </span>
              </button>
            )}
            <button
              onClick={() => { setMenuRow(null); removeTodo(menuRow.todo.id, menuRow.todo.title); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10"
            >
              <span className="w-5 shrink-0 text-center text-sm leading-none">🗑</span>
              <span className="min-w-0 flex-1">删除行动</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { const t = menuRow.todo; setMenuRow(null); startEdit(t); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
            >
              <span className="w-5 shrink-0 text-center text-sm leading-none">✏️</span>
              <span className="min-w-0 flex-1">编辑标题与时间</span>
            </button>
            <button
              onClick={() => { const t = menuRow.todo; setMenuRow(null); setPickerRow({ id: t.id, spaceId: t.space_id }); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
            >
              <span className="w-5 shrink-0 text-center text-sm leading-none">🎯</span>
              <span className="min-w-0 flex-1">关联空间</span>
            </button>
            {menuRow.todo.status !== "done" && (
              <button
                onClick={() => { setMenuRow(null); decompose({ id: menuRow.todo.id, title: menuRow.todo.title, isAction: false }); }}
                disabled={busyId === menuRow.todo.id}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash disabled:opacity-40"
              >
                <span className="w-5 shrink-0 text-center text-sm leading-none">{busyId === menuRow.todo.id ? "⏳" : "✨"}</span>
                <span className="min-w-0 flex-1">
                  AI 拆解为可执行的行动
                  <span className="block truncate text-[10px] text-ink-faint">拆出 ≤10 个行动</span>
                </span>
              </button>
            )}
            <button
              onClick={() => { setMenuRow(null); removeTodo(menuRow.todo.id, menuRow.todo.title); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10"
            >
              <span className="w-5 shrink-0 text-center text-sm leading-none">🗑</span>
              <span className="min-w-0 flex-1">
                删除 todo
                <span className="block truncate text-[10px] text-ink-faint">其下行动一并删除</span>
              </span>
            </button>
          </>
        )}
      </div>
    </Dismissable>,
    document.body,
  );
}
