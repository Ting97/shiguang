"use client";

import type { Dispatch, SetStateAction } from "react";
import { Dismissable } from "@/components/dismissable";
import { isoToLocalInput } from "@/components/todo-bits";
import type { Activity, TodoItem } from "@/lib/types";
import type { Msg } from "./types";
import type { TodoActions } from "./use-todo-actions";

/** 顶层 todo 行内编辑器（自 detail.tsx 拆出；与日程 todo-board 同交互；点空白/Esc 取消，有改动轻提示） */
export default function TodoEditRow(opts: {
  t: TodoItem;
  actions: TodoActions;
  activities: Activity[];
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { t, actions, activities, setMsg } = opts;
  const {
    editTitle, setEditTitle, editDue, setEditDue, editActivity, setEditActivity,
    setEditingId, saveEdit,
  } = actions;
  return (
    <Dismissable
      onClose={() => {
        const dirty = editTitle !== t.title || editDue !== isoToLocalInput(t.due_at) || editActivity !== (t.activity_id ?? "other");
        if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
        setEditingId(null);
      }}
      className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveEdit();
            if (e.key === "Escape") setEditingId(null);
          }}
          className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
        <input
          type="datetime-local"
          value={editDue}
          onChange={(e) => setEditDue(e.target.value)}
          title="截止时间（可清空）"
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <select
          value={editActivity}
          onChange={(e) => setEditActivity(e.target.value)}
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
        <button onClick={() => setEditingId(null)} className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft">
          取消
        </button>
        <button onClick={() => void saveEdit()} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500">
          保存
        </button>
      </div>
    </Dismissable>
  );
}
