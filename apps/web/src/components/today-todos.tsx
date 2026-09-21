"use client";

import Link from "next/link";
import { useState } from "react";
import type { Activity, TodoItem, TodoRow } from "@/lib/types";
import TodoLogo from "@/components/todo-logo";
import { TodoCircle, childProgress, dueTag, isoToLocalInput, localInputToIso, zhTime } from "./todo-bits";

/**
 * 主页「今日 TODO」区：只展示手动标记今日的待办（微软 To Do「我的一天」语义）。
 * 数据来自 /api/today（today_tag_date = 北京今天），跨零点自动失效，由用户每天重新规划。
 * 支持快速添加（自动标今日）、勾选完成、子任务进度、⭐ 标记；完整管理在「日程 · TODO」。
 */

interface Props {
  todos: TodoItem[];
  doneToday: TodoRow[];
  activities: Activity[];
  onChanged: () => Promise<void> | void;
  notify: (m: { ok: boolean; text: string }) => void;
}

export default function TodayTodos({ todos, doneToday, activities, onChanged, notify }: Props) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");

  const total = todos.length + doneToday.length;
  const doneN = doneToday.length;

  /** 快速添加：回车即建并自动标记今日 */
  async function quickAdd() {
    const title = newTitle.trim();
    if (!title || newBusy) return;
    setNewBusy(true);
    try {
      const r = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, today: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setNewTitle("");
      setAdding(false);
      notify({ ok: true, text: `☀️ 已加入今日：「${j.todo.title}」` });
      await onChanged();
    } catch (e) {
      notify({ ok: false, text: `添加失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setNewBusy(false);
    }
  }

  async function patchTodo(id: string, body: Record<string, unknown>, okText?: string) {
    const r = await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      notify({ ok: false, text: j.error ?? "操作失败" });
      return false;
    }
    if (okText) notify({ ok: true, text: okText });
    await onChanged();
    return true;
  }

  async function toggleDone(t: TodoRow) {
    const done = t.status === "done";
    await patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️ 「${t.title}」已恢复` : `🎉 完成「${t.title}」`);
  }

  async function removeTodo(t: TodoRow, isChild: boolean) {
    if (!window.confirm(`删除${isChild ? "子任务" : "任务"}？${isChild ? "" : "\n其子任务将一并删除。"}\n「${t.title}」`)) return;
    const r = await fetch(`/api/todos/${t.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      notify({ ok: false, text: j.error ?? "删除失败" });
      return;
    }
    notify({ ok: true, text: `🗑 已删除「${t.title}」` });
    await onChanged();
  }

  function startEdit(t: TodoRow) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(isoToLocalInput(t.due_at));
    setEditActivity(t.activity_id ?? "other");
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) {
      notify({ ok: false, text: "标题不能为空" });
      return;
    }
    const ok = await patchTodo(
      editingId,
      { title: editTitle.trim(), dueAt: localInputToIso(editDue), activityId: editActivity },
      "💾 已保存",
    );
    if (ok) setEditingId(null);
  }

  const editEditor = (compact: boolean) => (
    <div className={`rounded-lg border border-sky-500/40 bg-elevated/60 p-3 ${compact ? "" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit();
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
        <button onClick={saveEdit} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500">
          保存
        </button>
      </div>
    </div>
  );

  return (
    <section id="todos" className="glass mb-6 rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <TodoLogo size={17} />
          <span>
            TODO · 今日{" "}
            <span className="text-xs font-normal text-ink-dim">
              {total > 0 ? `完成 ${doneN}/${total}` : "每天重新规划"}
            </span>
          </span>
        </h2>
        <Link
          href="/schedule?tab=todo"
          className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1 text-xs text-accent transition hover:border-sky-500/50"
        >
          规划 →
        </Link>
      </div>

      {/* 今日任务列表 */}
      {todos.length === 0 && !adding ? (
        <p className="py-3 text-center text-xs text-ink-faint">
          今天还没安排 —— 在下面输入框添加，或
          <Link href="/schedule?tab=todo" className="mx-0.5 text-accent underline-offset-2 hover:underline">
            去「日程 · TODO」
          </Link>
          把已有任务标为今日 ☀️
        </p>
      ) : (
        <ul className="space-y-1">
          {todos.map((t) => {
            const tag = dueTag(t.due_at);
            const prog = childProgress(t.children);
            const open = expanded.has(t.id);
            return (
              <li key={t.id} className="group rounded-xl px-2 py-1 transition hover:bg-elevated/60">
                {editingId === t.id ? (
                  editEditor(false)
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <TodoCircle done={false} onClick={() => toggleDone(t)} />
                      <button
                        onClick={() => startEdit(t)}
                        className="min-w-0 flex-1 truncate text-left text-sm"
                        title={t.title}
                      >
                        {t.title}
                      </button>
                      {t.is_important && <span className="shrink-0 text-xs text-warn" title="重要">⭐</span>}
                      {prog && prog.m > 0 && (
                        <button
                          onClick={() => setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(t.id)) n.delete(t.id);
                            else n.add(t.id);
                            return n;
                          })}
                          className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-ink-dim transition hover:text-accent"
                          title="子任务进度"
                        >
                          {prog.n}/{prog.m}
                        </button>
                      )}
                      {tag && <span className={`shrink-0 text-xs ${tag.cls}`}>{tag.text}</span>}
                      <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        <button
                          onClick={() => patchTodo(t.id, { important: !t.is_important })}
                          title={t.is_important ? "取消重要" : "标记重要"}
                          className={`rounded px-1.5 py-0.5 text-xs transition hover:bg-soft ${t.is_important ? "text-warn" : "text-ink-mute opacity-60 hover:text-warn"}`}
                        >
                          ⭐
                        </button>
                        <button
                          onClick={() => patchTodo(t.id, { today: false }, `☁️ 「${t.title}」已移出今日`)}
                          title="移出今日"
                          className="rounded px-1.5 py-0.5 text-xs text-accent opacity-60 transition hover:bg-soft hover:opacity-100"
                        >
                          ☀️
                        </button>
                        <button
                          onClick={() => removeTodo(t, false)}
                          title="删除（子任务一并删除）"
                          className="rounded px-1.5 py-0.5 text-xs text-ink-mute opacity-60 transition hover:bg-soft hover:text-danger"
                        >
                          🗑
                        </button>
                      </span>
                      {t.children.length > 0 && (
                        <button
                          onClick={() => setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(t.id)) n.delete(t.id);
                            else n.add(t.id);
                            return n;
                          })}
                          title={open ? "收起子任务" : "展开子任务"}
                          className={`tap-lg shrink-0 text-[10px] text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                        >
                          ▼
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="ml-8 mt-0.5 space-y-0.5 border-l border-line-soft pl-3">
                        {t.children.map((c) => (
                          <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-elevated/60">
                            <TodoCircle size="sm" done={c.status === "done"} onClick={() => toggleDone(c)} />
                            <span className={`min-w-0 flex-1 truncate text-[13px] ${c.status === "done" ? "text-ink-faint line-through" : ""}`} title={c.title}>
                              {c.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 快速添加：回车即建并自动标记今日 */}
      <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-3 py-2 transition focus-within:border-sky-500/60">
        <span className="text-sm opacity-60">＋</span>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onFocus={() => setAdding(true)}
          onBlur={() => !newTitle && setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) quickAdd();
            if (e.key === "Escape") {
              setNewTitle("");
              setAdding(false);
            }
          }}
          placeholder="添加今日任务，回车保存"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        {newBusy && <span className="shrink-0 text-xs text-ink-dim">保存中…</span>}
      </div>

      {/* 今日已完成 */}
      {doneToday.length > 0 && (
        <details className="mt-3 border-t border-line-soft pt-3">
          <summary className="cursor-pointer text-xs text-ink-dim">今日已完成 {doneToday.length} 项（可恢复 / 删除）</summary>
          <ul className="mt-2 space-y-1">
            {doneToday.map((t) =>
              editingId === t.id ? (
                <li key={t.id}>{editEditor(true)}</li>
              ) : (
                <li key={t.id} className="group flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-elevated/60">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-[9px] text-white">✓</span>
                  <span className="flex-1 truncate text-xs text-ink-dim line-through">{t.title}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{t.done_at ? zhTime(t.done_at) : ""}</span>
                  <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={() => patchTodo(t.id, { undone: true }, `↩️ 「${t.title}」已恢复为未完成`)}
                      title="恢复为未完成"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-warn"
                    >
                      ↩️
                    </button>
                    <button
                      onClick={() => removeTodo(t, false)}
                      title="删除"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger"
                    >
                      🗑
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </details>
      )}
    </section>
  );
}
