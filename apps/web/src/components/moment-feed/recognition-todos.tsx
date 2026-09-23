"use client";

import { useState } from "react";
import type { Activity, FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import { TagChip } from "../tag-chip";
import { RowAction } from "./row-action";
import { isoToLocalInput, localInputToIso, todoTimeLabel } from "./kit";
import type { DelFn, RunFn } from "./types";

/** todo 行内编辑态 */
interface EditTodoState {
  id: string;
  title: string;
  start: string;
  due: string;
  activityId: string;
}

interface TodoRowsProps {
  m: FeedMoment;
  activities: Activity[];
  run: RunFn;
  del: DelFn;
}

/** ---- todo ----：展示 + 行内编辑/删除 */
export function TodoRows({ m, activities, run, del }: TodoRowsProps) {
  const [editTodo, setEditTodo] = useState<EditTodoState | null>(null);

  return (
    <>
      {m.todos.map((td) =>
        editTodo?.id === td.id ? (
          <div key={td.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
            <input
              value={editTodo.title}
              onChange={(e) => setEditTodo({ ...editTodo, title: e.target.value })}
              className="min-w-28 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
              placeholder="标题"
            />
            <input
              type="datetime-local"
              value={editTodo.start}
              onChange={(e) => setEditTodo({ ...editTodo, start: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
              title="开始时间（可清空）"
            />
            <input
              type="datetime-local"
              value={editTodo.due}
              onChange={(e) => setEditTodo({ ...editTodo, due: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
              title="到期时间"
            />
            <select
              value={editTodo.activityId}
              onChange={(e) => setEditTodo({ ...editTodo, activityId: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
            <span className="flex gap-1">
              <button onClick={() => setEditTodo(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
              <button
                onClick={() =>
                  run(async () => {
                    if (!editTodo.title.trim()) throw new Error("标题不能为空");
                    await api(`/api/todos/${td.id}`, "PATCH", {
                      title: editTodo.title.trim(),
                      startAt: localInputToIso(editTodo.start),
                      dueAt: localInputToIso(editTodo.due),
                      activityId: editTodo.activityId,
                    });
                    setEditTodo(null);
                    return "💾 todo 已更新";
                  })
                }
                className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
              >
                保存
              </button>
            </span>
          </div>
        ) : (
          <p key={td.id} className="group/row flex items-center gap-x-2">
            <TagChip icon="📋" label="todo" tone="sky" size="sm" className="shrink-0" />
            <span className="truncate">{td.title}</span>
            <span className="shrink-0 text-ink-mute">
              {todoTimeLabel(td.startAt, td.dueAt) ?? "未定时间"}
            </span>
            {td.status === "done" && <span className="shrink-0 text-success">已完成</span>}
            <RowAction
              onEdit={() =>
                setEditTodo({
                  id: td.id,
                  title: td.title,
                  start: isoToLocalInput(td.startAt ?? null),
                  due: isoToLocalInput(td.dueAt),
                  activityId: activities.some((a) => a.id === td.activityId) ? td.activityId! : activities[0]?.id ?? "",
                })
              }
              onDelete={() => del(`删除这条 todo？\n「${td.title}」`, () => api(`/api/todos/${td.id}`, "DELETE"))}
            />
          </p>
        ),
      )}
    </>
  );
}
