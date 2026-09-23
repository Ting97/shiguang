"use client";

import type { MouseEvent } from "react";
import type { Activity, Space, TodoItem, TodoRow } from "@/lib/types";
import { Dismissable } from "../dismissable";
import { TodoCircle, childProgress, dueTag } from "../todo-bits";
import { ChildArea } from "./child-area";
import type { SubtaskCtl } from "./types";
import type { ActionNote } from "./use-action-note";
import type { TodoEdit } from "./use-todo-edit";

/** 顶层 todo 卡片（拆分自 todo-board，行为零变化）：行内编辑器 ↔ 展示行（分类/空间徽标、进度、到期标签、⋯菜单、展开）+ 行动子区 */
export function TodoCard({
  t,
  activities,
  spaces,
  open,
  edit,
  note,
  sub,
  onToggleDone,
  onToggleExpand,
  onOpenMenu,
}: {
  t: TodoItem;
  activities: Activity[];
  spaces: Space[];
  open: boolean;
  edit: TodoEdit;
  note: ActionNote;
  sub: SubtaskCtl;
  onToggleDone: (t: TodoRow) => void;
  onToggleExpand: (id: string) => void;
  onOpenMenu: (e: MouseEvent, todo: TodoRow, isChild: boolean, parentTitle?: string) => void;
}) {
  // 已完成的任务不再展示过期/到期标签（截止时间对已完成的任务没有意义）
  const tag = t.status === "done" ? null : dueTag(t.due_at);
  const prog = childProgress(t.children);
  const isEditing = edit.editingId === t.id;
  const done = t.status === "done";
  return (
    <li className="group rounded-xl px-2 py-1 transition hover:bg-elevated/60">
      {isEditing ? (
        /* ---- 行内编辑器（N3：点空白/Esc 取消，有改动轻提示） ---- */
        <Dismissable
          onClose={() => edit.closeEdit(t)}
          className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={edit.editTitle}
              onChange={(e) => edit.setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) edit.saveEdit();
                if (e.key === "Escape") edit.setEditingId(null);
              }}
              className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
            />
            <input
              type="datetime-local"
              value={edit.editDue}
              onChange={(e) => edit.setEditDue(e.target.value)}
              title="截止时间（可清空）"
              className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
            />
            <select
              value={edit.editActivity}
              onChange={(e) => edit.setEditActivity(e.target.value)}
              className="rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => edit.setEditingId(null)} className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft">
              取消
            </button>
            <button onClick={edit.saveEdit} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500">
              保存
            </button>
          </div>
        </Dismissable>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <TodoCircle done={done} onClick={() => onToggleDone(t)} />
            <button
              onClick={() => edit.startEdit(t)}
              className={`min-w-0 flex-1 truncate text-left text-sm transition ${done ? "text-ink-dim line-through" : ""}`}
              title={t.title}
            >
              {t.kind === "action" && <span className="mr-1.5 inline-flex shrink-0 items-center rounded-lg bg-slate-500/15 px-1.5 py-0.5 align-middle text-[10px] font-medium text-ink-dim" title="独立行动（不属于任何 todo）">行动</span>}
                {t.title}
              </button>
            {t.activity_name && <span className="hidden shrink-0 text-[11px] text-ink-faint sm:inline">{t.icon} {t.activity_name}</span>}
            {t.space_id && (() => {
              const sp = spaces.find((x) => x.id === t.space_id);
              return sp ? (
                <span className="hidden shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex" style={{ backgroundColor: `${sp.color}26`, color: sp.color }} title={`空间：${sp.name}`}>
                  {sp.icon} {sp.name}
                </span>
              ) : null;
            })()}
            {prog && prog.m > 0 && (
              <button
                onClick={() => onToggleExpand(t.id)}
                className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-ink-dim transition hover:text-accent"
                title="行动进度"
              >
                {prog.n}/{prog.m}
              </button>
            )}
            {tag && <span className={`shrink-0 text-xs ${tag.cls}`}>{tag.text}</span>}
            <button
              onClick={(e) => onOpenMenu(e, t, false)}
              title="更多操作"
              className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover:block"
            >
              ⋯
            </button>
            {(t.children.length > 0) && (
                <button
                onClick={() => onToggleExpand(t.id)}
                title={open ? "收起行动" : "展开行动"}
                className={`tap-lg shrink-0 text-[10px] text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              >
                ▼
              </button>
            )}
          </div>
          {/* 子任务区（最多一层） */}
          {open && <ChildArea t={t} note={note} sub={sub} onToggleDone={onToggleDone} onOpenMenu={onOpenMenu} />}
        </>
      )}
    </li>
  );
}
