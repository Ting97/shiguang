"use client";

import type { Dispatch, SetStateAction } from "react";
import { TagChip } from "@/components/tag-chip";
import { TodoCircle, childProgress, dueTag } from "@/components/todo-bits";
import type { Activity, TodoItem } from "@/lib/types";
import NotePanel from "./note-panel";
import TodoEditRow from "./todo-edit-row";
import type { Msg } from "./types";
import type { TodoActions } from "./use-todo-actions";

/** 顶层关联 todo 行（自 detail.tsx 拆出）：勾选/标题/行动列表/添加行动/AI 拆解/行内编辑/行动详情 */
export default function TodoRowItem(opts: {
  t: TodoItem;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  actions: TodoActions;
  activities: Activity[];
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { t, expanded, setExpanded, actions, activities, setMsg } = opts;
  const {
    editingId, busyId, patchTodo, decompose, startEdit, pendingCount,
    noteOpen, setNoteOpen, openNote,
    actionDrafts, setActionDrafts, addAction,
    setMenuRow, setMenuPos,
  } = actions;
  const done = t.status === "done";
  const open = expanded.has(t.id);
  const tag = done ? null : dueTag(t.due_at);
  return (
    <li className="rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
      {editingId === t.id ? (
        /* ---- 行内编辑器（与日程 todo-board 同交互；点空白/Esc 取消，有改动轻提示） ---- */
        <TodoEditRow t={t} actions={actions} activities={activities} setMsg={setMsg} />
      ) : (
        <>
          <div className="group flex items-center gap-2.5">
            <TodoCircle size="md" done={done} disabled={busyId === t.id} onClick={() => patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️「${t.title}」已恢复` : `✅「${t.title}」已完成`)} />
            <button
              onClick={() => startEdit(t)}
              className={`min-w-0 flex-1 truncate text-left text-sm transition hover:text-accent ${done ? "text-ink-faint line-through" : ""}`}
              title={`${t.title}（点击编辑）`}
            >
              {t.title}
            </button>
            {t.children.length > 0 && <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{(() => { const p = childProgress(t.children); return p ? `${p.n}/${p.m}` : ""; })()}</span>}
            {tag && <span className={`shrink-0 text-[11px] ${tag.cls}`}>{tag.text}</span>}
            <button
              onClick={(e) => {
                if (pendingCount(t) > 0) {
                  // 已有未完成行动：打开行菜单给出「重新生成 / 追加」显式选择，不盲发
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 260), left: Math.max(8, r.right - 224) });
                  setMenuRow({ todo: t, isChild: false });
                  return;
                }
                void decompose({ id: t.id, title: t.title, isAction: false });
              }}
              disabled={busyId === t.id || done}
              title="AI 拆解为行动"
              className="row-actions hidden shrink-0 rounded px-1.5 py-0.5 text-xs text-ai opacity-60 transition hover:bg-soft disabled:opacity-30 group-hover:block"
            >
              {busyId === t.id ? "✨…" : "✨ 拆解"}
            </button>
            <button
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 260), left: Math.max(8, r.right - 224) });
                setMenuRow({ todo: t, isChild: false });
              }}
              title="更多操作"
              className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover:block"
            >
              ⋯
            </button>
            {/* C1：未完成 todo 始终可展开行动区（含添加行动入口）；已完成的仅在有行动时可展开查看 */}
            {(t.children.length > 0 || !done) && (
              <button
                onClick={() => setExpanded((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                title={open ? "收起行动" : "展开行动"}
                className={`-mx-2 -my-3 shrink-0 p-2 text-[10px] text-ink-mute transition-transform hover:text-ink ${open ? "rotate-180" : ""}`}
              >
                ▼
              </button>
            )}
          </div>
          {/* 行动列表 */}
          {open && (
            <div className="ml-8 mt-1 space-y-0.5 border-l border-line-soft pl-3">
              {t.children.map((c) => {
                const cDone = c.status === "done";
                return (
                  <div key={c.id} className="group/child flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-elevated/60">
                    <TodoCircle size="sm" done={cDone} disabled={busyId === c.id} onClick={() => patchTodo(c.id, cDone ? { undone: true } : { done: true }, cDone ? "↩️ 已恢复" : "✅ 已完成")}/>
                    <span className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] transition hover:text-accent ${cDone ? "text-ink-faint line-through" : ""}`} onClick={() => (noteOpen === c.id ? setNoteOpen(null) : openNote(c))} title={`${c.title}（点击编辑详情）`}>
                      {c.title}
                    </span>
                    {c.repeat_daily && <TagChip icon="🔁" label={c.repeat_done_count > 0 ? `×${c.repeat_done_count}` : "每日"} tone="emerald" size="sm" />}
                    {c.note && <span className="shrink-0 text-[10px] text-ink-faint">📄</span>}
                    <button
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 240), left: Math.max(8, r.right - 224) });
                        setMenuRow({ todo: c, isChild: true });
                      }}
                      title="更多操作"
                      className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover/child:block"
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
              {/* C1：手动添加行动（回车保存；已完成 todo 不可再加） */}
              {!done && (
                <div className="flex items-center gap-2.5 px-1.5 py-1">
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-line-strong" />
                  <input
                    value={actionDrafts[t.id] ?? ""}
                    onChange={(e) => setActionDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) void addAction(t);
                    }}
                    placeholder="＋ 添加行动，回车保存"
                    maxLength={200}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
                  />
                </div>
              )}
              {t.children.length === 0 && (
                <button
                  onClick={() => decompose({ id: t.id, title: t.title, isAction: false })}
                  disabled={busyId === t.id || done}
                  className="rounded-lg px-2 py-1 text-[11px] text-ai/80 transition hover:bg-soft disabled:opacity-40"
                >
                  {busyId === t.id ? "✨ AI 拆解中…" : "✨ 让 AI 拆解为可执行的行动"}
                </button>
              )}
            </div>
          )}
          {/* 行动详情面板（可编辑，与 todo-board 同交互；点空白/Esc 取消，有改动轻提示） */}
          {noteOpen && t.children.some((c) => c.id === noteOpen) && (() => {
            const c = t.children.find((x) => x.id === noteOpen)!;
            return <NotePanel c={c} actions={actions} setMsg={setMsg} />;
          })()}
        </>
      )}
    </li>
  );
}
