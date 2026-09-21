"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity, TodoItem, TodoRow } from "@/lib/types";
import { TodoCircle, childProgress, dueTag, isoToLocalInput, localInputToIso } from "./todo-bits";

/**
 * TODO 管理视图（微软 To Do 式，日程页 TODO 子页）：
 * - 智能列表：☀️ 今日（手动标记，跨零点自动失效）/ ⭐ 重要 / 📋 全部 / ✓ 已完成
 * - 移动端顶部横滑 chips；PC（lg+）左侧列表栏 + 右侧主列表
 * - 任务树：子任务最多一层；标记（今日/重要）只作用于顶层任务，子任务随父
 */

type View = "today" | "important" | "all" | "done";
const VIEWS: [View, string][] = [
  ["today", "☀️ 今日"],
  ["important", "⭐ 重要"],
  ["all", "📋 全部"],
  ["done", "✓ 已完成"],
];

interface Draft {
  title: string;
  important: boolean;
  today: boolean;
  due: string; // datetime-local 值，空串=无截止
  activityId: string; // "other" 默认
}
const EMPTY_DRAFT: Draft = { title: "", important: false, today: false, due: "", activityId: "" };

export default function TodoBoard() {
  const [view, setView] = useState<View>("today");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [counts, setCounts] = useState({ today: 0, important: 0, all: 0, done: 0 });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftOpen, setDraftOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subParentId, setSubParentId] = useState<string | null>(null); // 正在添加子任务的任务
  const [subTitle, setSubTitle] = useState("");
  const chipRefs = useRef<Record<View, HTMLButtonElement | null>>({} as Record<View, HTMLButtonElement | null>);

  // 视图切换后把激活 chip 滚入视野（窄屏四个 chip 放不下，与顶部导航同款处理）
  // 注意：容器内 smooth 水平滚动在部分内核不生效，用 instant 立即定位
  useEffect(() => {
    chipRefs.current[view]?.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, [view]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3000 : 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const loadActivities = useCallback(async () => {
    const r = await fetch("/api/activities");
    setActivities((await r.json()).activities ?? []);
  }, []);
  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  const load = useCallback(async (v: View) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/todos?view=${v}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setTodos(j.todos ?? []);
      setCounts(j.counts ?? { today: 0, important: 0, all: 0, done: 0 });
    } catch (e) {
      setMsg({ ok: false, text: `加载失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(view);
  }, [view, load]);

  // 活动分类默认选中「其他」
  useEffect(() => {
    if (!draft.activityId && activities.length > 0) {
      const other = activities.find((a) => a.id === "other") ?? activities[0];
      setDraft((d) => ({ ...d, activityId: other.id }));
    }
  }, [activities, draft.activityId]);

  async function addTodo() {
    const title = draft.title.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const r = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          activityId: draft.activityId || undefined,
          important: draft.important || view === "important" ? true : undefined,
          today: draft.today || view === "today" ? true : undefined,
          dueAt: draft.due ? localInputToIso(draft.due) : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDraft({ ...EMPTY_DRAFT, activityId: draft.activityId });
      setDraftOpen(false);
      setMsg({ ok: true, text: `📌 已添加「${j.todo.title}」` });
      await load(view);
    } catch (e) {
      setMsg({ ok: false, text: `添加失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setAdding(false);
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
      setMsg({ ok: false, text: j.error ?? "操作失败" });
      return false;
    }
    if (okText) setMsg({ ok: true, text: okText });
    await load(view);
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
      setMsg({ ok: false, text: j.error ?? "删除失败" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除「${t.title}」` });
    await load(view);
  }

  function startEdit(t: TodoRow) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(isoToLocalInput(t.due_at));
    setEditActivity(t.activity_id ?? "other");
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    const ok = await patchTodo(
      editingId,
      { title: editTitle.trim(), dueAt: localInputToIso(editDue), activityId: editActivity },
      "💾 已保存",
    );
    if (ok) setEditingId(null);
  }

  async function addSubtask(parentId: string) {
    const title = subTitle.trim();
    if (!title) return;
    const r = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, parentId }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? "添加失败" });
      return;
    }
    setSubTitle("");
    await load(view);
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const emptyText: Record<View, string> = {
    today: "今天还没安排 ☀️ —— 在上面添加任务（会自动标记今日），或把 ⭐重要 / 📋全部 里的任务标为今日",
    important: "还没有重要任务 ⭐ —— 添加时勾选「重要」，或把现有任务标为重要",
    all: "暂无待办 —— 在上面添加一个，或在主页随口说一句（AI 会自动识别待办）",
    done: "还没有已完成的任务 ✓",
  };

  const viewBar = (vertical: boolean) =>
    VIEWS.map(([v, label]) => {
      const active = view === v;
      return (
        <button
          key={v}
          ref={vertical ? undefined : (el) => {
            chipRefs.current[v] = el;
          }}
          onClick={() => setView(v)}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] transition-all duration-200 ${
            vertical ? "w-full justify-between" : ""
          } ${
            active
              ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
              : "text-ink-mute hover:bg-wash hover:text-ink"
          }`}
        >
          {label}
          <span
            className={`min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums ${
              active ? "bg-white/25 text-white" : "bg-elevated text-ink-dim"
            }`}
          >
            {counts[v]}
          </span>
        </button>
      );
    });

  return (
    <div>
      {msg && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 移动端：横滑 chips（lg 以下） */}
      <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">{viewBar(false)}</div>

      <div className="lg:grid lg:grid-cols-[190px_1fr] lg:gap-5">
        {/* PC：左侧智能列表栏 */}
        <aside className="hidden lg:block">
          <div className="glass sticky top-20 space-y-1 rounded-2xl p-2">{viewBar(true)}</div>
        </aside>

        {/* 主列表 */}
        <div className="min-w-0">
          {/* 添加任务行（已完成视图不显示） */}
          {view !== "done" && (
            <div className="glass mb-3 rounded-2xl p-2.5 transition focus-within:border-sky-500/50">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-500 opacity-70" />
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  onFocus={() => setDraftOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) addTodo();
                    if (e.key === "Escape") {
                      setDraftOpen(false);
                      setDraft({ ...EMPTY_DRAFT, activityId: draft.activityId });
                    }
                  }}
                  placeholder="添加任务，回车保存"
                  maxLength={200}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
                />
                <button
                  onClick={addTodo}
                  disabled={!draft.title.trim() || adding}
                  className="btn-primary shrink-0 rounded-lg px-4 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {adding ? "保存中…" : "添加"}
                </button>
              </div>
              {draftOpen && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-2.5 text-xs">
                  <button
                    onClick={() => setDraft({ ...draft, important: !draft.important })}
                    title="重要标记"
                    className={`rounded-full px-3 py-1.5 transition ${
                      draft.important ? "bg-amber-500/20 text-warn" : "border border-line-soft text-ink-mute hover:text-ink"
                    }`}
                  >
                    ⭐ 重要
                  </button>
                  <button
                    onClick={() => setDraft({ ...draft, today: !draft.today })}
                    title="今日标记（跨零点自动失效，每天重新规划）"
                    className={`rounded-full px-3 py-1.5 transition ${
                      draft.today || view === "today" ? "bg-sky-500/20 text-accent" : "border border-line-soft text-ink-mute hover:text-ink"
                    }`}
                  >
                    ☀️ 今日
                  </button>
                  <input
                    type="datetime-local"
                    value={draft.due}
                    onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-2 py-1.5 tabular-nums outline-none focus:border-sky-500"
                  />
                  <select
                    value={draft.activityId}
                    onChange={(e) => setDraft({ ...draft, activityId: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-sky-500"
                  >
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.icon} {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
          ) : todos.length === 0 ? (
            <div className="empty-state py-8 text-xs">{emptyText[view]}</div>
          ) : (
            <ul className="space-y-1">
              {todos.map((t) => {
                const tag = dueTag(t.due_at);
                const prog = childProgress(t.children);
                const isEditing = editingId === t.id;
                const open = expanded.has(t.id);
                const done = t.status === "done";
                return (
                  <li key={t.id} className="group rounded-xl px-2 py-1 transition hover:bg-elevated/60">
                    {isEditing ? (
                      /* ---- 行内编辑器 ---- */
                      <div className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3">
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
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <TodoCircle done={done} onClick={() => toggleDone(t)} />
                          <button
                            onClick={() => startEdit(t)}
                            className={`min-w-0 flex-1 truncate text-left text-sm transition ${done ? "text-ink-dim line-through" : ""}`}
                            title={t.title}
                          >
                            {t.title}
                          </button>
                          {t.activity_name && <span className="hidden shrink-0 text-[11px] text-ink-faint sm:inline">{t.icon} {t.activity_name}</span>}
                          {prog && prog.m > 0 && (
                            <button
                              onClick={() => toggleExpand(t.id)}
                              className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-ink-dim transition hover:text-accent"
                              title="子任务进度"
                            >
                              {prog.n}/{prog.m}
                            </button>
                          )}
                          {tag && <span className={`shrink-0 text-xs ${tag.cls}`}>{tag.text}</span>}
                          <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover:flex">
                            {(view === "done" ? !done : true) && (
                              <button
                                onClick={() => patchTodo(t.id, { important: !t.is_important })}
                                title={t.is_important ? "取消重要" : "标记重要"}
                                className={`rounded px-1.5 py-0.5 text-xs transition hover:bg-soft ${t.is_important ? "text-warn" : "text-ink-mute opacity-60 hover:text-warn"}`}
                              >
                                ⭐
                              </button>
                            )}
                            {!done && (
                              <button
                                onClick={() => patchTodo(t.id, { today: !t.today_tag_date })}
                                title={t.today_tag_date ? "移出今日" : "标记今日（跨零点自动失效）"}
                                className={`rounded px-1.5 py-0.5 text-xs transition hover:bg-soft ${t.today_tag_date ? "text-accent" : "text-ink-mute opacity-60 hover:text-accent"}`}
                              >
                                ☀️
                              </button>
                            )}
                            {!done && (
                              <button
                                onClick={() => {
                                  setSubParentId(subParentId === t.id ? null : t.id);
                                  setSubTitle("");
                                  setExpanded((s) => new Set(s).add(t.id));
                                }}
                                title="添加子任务"
                                className="rounded px-1.5 py-0.5 text-xs text-ink-mute opacity-60 transition hover:bg-soft hover:text-accent"
                              >
                                ＋
                              </button>
                            )}
                            <button
                              onClick={() => removeTodo(t, false)}
                              title="删除（子任务一并删除）"
                              className="rounded px-1.5 py-0.5 text-xs text-ink-mute opacity-60 transition hover:bg-soft hover:text-danger"
                            >
                              🗑
                            </button>
                          </span>
                          {(t.children.length > 0) && (
                              <button
                              onClick={() => toggleExpand(t.id)}
                              title={open ? "收起子任务" : "展开子任务"}
                              className={`tap-lg shrink-0 text-[10px] text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                            >
                              ▼
                            </button>
                          )}
                        </div>
                        {/* 子任务区（最多一层） */}
                        {open && (
                          <div className="ml-8 mt-0.5 space-y-0.5 border-l border-line-soft pl-3">
                            {t.children.map((c) => {
                              const ctag = dueTag(c.due_at);
                              const cDone = c.status === "done";
                              return (
                                <div key={c.id} className="group/child rounded-lg px-1.5 py-1 transition hover:bg-elevated/60">
                                  {editingId === c.id ? (
                                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
                                      <input
                                        autoFocus
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit();
                                          if (e.key === "Escape") setEditingId(null);
                                        }}
                                        className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-[13px] outline-none focus:border-sky-500"
                                      />
                                      <input
                                        type="datetime-local"
                                        value={editDue}
                                        onChange={(e) => setEditDue(e.target.value)}
                                        title="截止时间（可清空）"
                                        className="rounded border border-line-strong bg-surface px-2 py-1 text-[13px] tabular-nums outline-none focus:border-sky-500"
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-xs text-ink-mute hover:bg-soft">
                                          取消
                                        </button>
                                        <button onClick={saveEdit} className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium hover:bg-sky-500">
                                          保存
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2.5">
                                      <TodoCircle size="sm" done={cDone} onClick={() => toggleDone(c)} />
                                      <span
                                        className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] ${cDone ? "text-ink-faint line-through" : ""}`}
                                        onClick={() => startEdit(c)}
                                        title={c.title}
                                      >
                                        {c.title}
                                      </span>
                                      {ctag && <span className={`shrink-0 text-[11px] ${ctag.cls}`}>{ctag.text}</span>}
                                      <span className="row-actions hidden shrink-0 gap-0.5 group-hover/child:flex">
                                        <button
                                          onClick={() => removeTodo(c, true)}
                                          title="删除子任务"
                                          className="rounded px-1.5 py-0.5 text-xs text-ink-mute transition hover:bg-soft hover:text-danger"
                                        >
                                          🗑
                                        </button>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {subParentId === t.id && (
                              <div className="flex items-center gap-2.5 px-1.5 py-1">
                                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-line-strong" />
                                <input
                                  autoFocus
                                  value={subTitle}
                                  onChange={(e) => setSubTitle(e.target.value)}
                                  onBlur={() => setSubParentId(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.nativeEvent.isComposing) addSubtask(t.id);
                                    if (e.key === "Escape") setSubParentId(null);
                                  }}
                                  placeholder="子任务，回车添加（Esc 结束）"
                                  maxLength={200}
                                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
                                />
                              </div>
                            )}
                            {t.children.length === 0 && subParentId !== t.id && (
                              <p className="px-1.5 py-1 text-[11px] text-ink-faint">还没有子任务 —— 点行右侧「＋」添加</p>
                            )}
                            {done && <p className="px-1.5 py-0.5 text-[11px] text-ink-faint">已完成任务不可再添加子任务</p>}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
              {view === "done" && (
                <li className="px-2 pt-3 text-center text-[11px] text-ink-faint">最多显示最近 200 条已完成的顶层任务</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
