"use client";

import type { MouseEvent } from "react";
import type { TodoItem, TodoRow } from "@/lib/types";
import { TodoCircle, dueTag } from "../todo-bits";
import { ActionNotePanel } from "./action-note-panel";
import type { SubtaskCtl } from "./types";
import type { ActionNote } from "./use-action-note";

/** 行动（子任务）区（拆分自 todo-board，行为零变化；最多一层）：详情面板 ↔ 展示行 + 添加输入行 + 空态/已完成提示 */
export function ChildArea({
  t,
  note,
  sub,
  onToggleDone,
  onOpenMenu,
}: {
  t: TodoItem;
  note: ActionNote;
  sub: SubtaskCtl;
  onToggleDone: (t: TodoRow) => void;
  onOpenMenu: (e: MouseEvent, todo: TodoRow, isChild: boolean, parentTitle?: string) => void;
}) {
  const done = t.status === "done";
  return (
    <div className="ml-8 mt-0.5 space-y-0.5 border-l border-line-soft pl-3">
      {t.children.map((c) => {
        const ctag = c.status === "done" ? null : dueTag(c.due_at);
        const cDone = c.status === "done";
        return (
          <div key={c.id} className="group/child rounded-lg px-1.5 py-1 transition hover:bg-elevated/60">
            {note.noteOpenId === c.id ? (
              <ActionNotePanel c={c} note={note} />
            ) : (
              <div className="flex items-center gap-2.5">
                <TodoCircle size="sm" done={cDone} onClick={() => onToggleDone(c)} />
                <span
                  className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] ${cDone ? "text-ink-faint line-through" : ""}`}
                  onClick={() => note.openNote(c)}
                  title={c.note ? `${c.title}（点击查看详情）` : c.title}
                >
                  {c.title}
                </span>
                {c.note && (
                  <span className="shrink-0 text-[10px] text-ink-faint" title="有点击查看详情">
                    📄
                  </span>
                )}
                {c.repeat_daily && (
                  <span
                    className="shrink-0 rounded-lg bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-success"
                    title="每日重复（06:00 日切自动恢复未完成）"
                  >
                    🔁 {c.repeat_done_count > 0 ? `×${c.repeat_done_count}` : ""}
                  </span>
                )}
                {ctag && <span className={`shrink-0 text-[11px] ${ctag.cls}`}>{ctag.text}</span>}
                <button
                  onClick={(e) => onOpenMenu(e, c, true, t.title)}
                  title="更多操作"
                  className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover/child:block"
                >
                  ⋯
                </button>
              </div>
            )}
          </div>
        );
      })}
      {sub.parentId === t.id && (
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-line-strong" />
          <input
            autoFocus
            value={sub.title}
            onChange={(e) => sub.setTitle(e.target.value)}
            onBlur={() => {
              // blur 即"点空白"（N3）；有未提交内容轻提示
              if (sub.title.trim()) sub.setMsg({ ok: true, text: "已取消，未保存" });
              sub.close();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) sub.add(t.id);
              if (e.key === "Escape") sub.close();
            }}
            placeholder="行动，回车添加（Esc 结束）"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
          />
        </div>
      )}
      {t.children.length === 0 && sub.parentId !== t.id && (
        <p className="px-1.5 py-1 text-[11px] text-ink-faint">还没有行动 —— 行右侧「⋯」里添加，或让 AI 拆解</p>
      )}
      {done && <p className="px-1.5 py-0.5 text-[11px] text-ink-faint">已完成的 todo 不可再添加行动</p>}
    </div>
  );
}
