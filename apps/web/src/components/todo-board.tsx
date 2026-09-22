"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Activity, Space, TodoItem, TodoRow } from "@/lib/types";
import { TodoCircle, childProgress, dueTag, isoToLocalInput, localInputToIso } from "./todo-bits";
import { FilterChip } from "./tag-chip";
import { useDismiss, Dismissable } from "./dismissable";

/**
 * TODO 管理视图（微软 To Do 式，日程页 TODO 子页）：
 * - 智能列表：☀️ 今日（手动标记，跨零点自动失效）/ ⭐ 重要 / 📋 全部 / ✓ 已完成
 * - 移动端顶部横滑 chips；PC（lg+）左侧列表栏 + 右侧主列表
 * - 任务树：行动（原子任务）最多一层；标记（今日/重要）只作用于顶层任务，行动随父
 * - REQ-001 R3：行动支持 ✨AI 拆解（插入式）、🔁 每日重复（×N 已完成次数）、关联目标空间
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
  spaceId: string; // ""=不关联空间
}
const EMPTY_DRAFT: Draft = { title: "", important: false, today: false, due: "", activityId: "", spaceId: "" };

/** 判断 id 是否为行动（子待办）：行内编辑据此决定是否提交 repeatDaily */
function isChildId(id: string, todos: TodoItem[]): boolean {
  return todos.some((t) => t.children.some((c) => c.id === id));
}

/** 行是否已完成（菜单分支用） */
const isDoneRow = (t: TodoRow) => t.status === "done";

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
  // N3：添加行展开后点空白收起；有未提交标题则轻提示
  const addRowRef = useDismiss<HTMLDivElement>(() => {
    if (!draftOpen) return;
    if (draft.title.trim()) setMsg({ ok: true, text: "已取消，未保存" });
    setDraftOpen(false);
    setDraft((d) => ({ ...EMPTY_DRAFT, activityId: d.activityId }));
  }, draftOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subParentId, setSubParentId] = useState<string | null>(null); // 正在添加子任务的任务
  const [subTitle, setSubTitle] = useState("");
  // 空间列表（添加行展开区选择；REQ-001 R3）
  const [spaces, setSpaces] = useState<Space[]>([]);
  // 行动行内编辑的 🔁 每日重复开关
  const [editRepeat, setEditRepeat] = useState(false);
  // AI 拆解进行中的节点 id
  const [decomposingId, setDecomposingId] = useState<string | null>(null);
  // 行操作菜单卡片（点「⋯」弹出，带文字标签；桌面锚定浮层 / 移动端底部弹层）
  const [menuRow, setMenuRow] = useState<{ todo: TodoRow; isChild: boolean; parentTitle?: string } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // 行动详情面板（点标题展开）：标题 + 详细内容（≤1000 字）+ 截止
  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDue, setNoteDue] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  // 行动详情面板里的 🔁 每日重复开关（与已完成次数只读展示）
  const [noteRepeat, setNoteRepeat] = useState(false);
  const [noteDoneCount, setNoteDoneCount] = useState(0);
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
    fetch("/api/spaces").then(async (r) => setSpaces(r.ok ? (await r.json()).spaces.filter((s: Space) => s.status === "active") : []));
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
          spaceId: draft.spaceId || undefined,
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

  /** AI 拆解（REQ-001 R3 · 插入式）：待办→≤10 行动（追加尾部/重新生成）；行动→≤3 同级细化（插入其后） */
  async function decompose(t: TodoRow, isAction: boolean) {
    if (decomposingId) return;
    setDecomposingId(t.id);
    try {
      let mode: string | undefined;
      if (!isAction) {
        const parent = todos.find((x) => x.id === t.id);
        const pending = parent?.children.filter((c) => c.status === "pending").length ?? 0;
        if (pending > 0) {
          mode = window.confirm(`「${t.title}」已有 ${pending} 个未完成行动。\n\n「确定」= 重新生成（清空未完成，已完成与次数保留）\n「取消」= 追加到末尾`)
            ? "replace"
            : "append";
        }
      }
      const r = await fetch(`/api/todos/${t.id}/decompose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode ? { mode } : {}),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ ok: false, text: j.error ?? "AI 拆解失败" });
        return;
      }
      setMsg({ ok: true, text: `✨ AI 拆出 ${j.actions.length} 个行动${isAction ? "，已插入原行动之后" : ""}` });
      await load(view);
    } finally {
      setDecomposingId(null);
    }
  }

  async function removeTodo(t: TodoRow, isChild: boolean) {
    if (!window.confirm(`删除${isChild ? "行动" : "todo"}？${isChild ? "" : "\n其下行动将一并删除。"}\n「${t.title}」`)) return;
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
    setEditRepeat(t.repeat_daily);
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    const ok = await patchTodo(
      editingId,
      {
        title: editTitle.trim(),
        dueAt: localInputToIso(editDue),
        activityId: editActivity,
        ...(isChildId(editingId, todos) ? { repeatDaily: editRepeat } : {}),
      },
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

  /** 点开行动详情：标题 + 描述 + 截止 + 🔁 每日重复（列表里只展示标题） */
  function openNote(c: TodoRow) {
    setNoteOpenId(c.id);
    setNoteTitle(c.title);
    setNoteText(c.note ?? "");
    setNoteDue(isoToLocalInput(c.due_at));
    setNoteRepeat(c.repeat_daily);
    setNoteDoneCount(c.repeat_done_count);
  }

  async function saveNote() {
    if (!noteOpenId || !noteTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    setNoteSaving(true);
    const ok = await patchTodo(
      noteOpenId,
      {
        title: noteTitle.trim(),
        note: noteText.trim() ? noteText.trim() : null,
        dueAt: localInputToIso(noteDue),
        repeatDaily: noteRepeat,
      },
      "💾 行动已保存",
    );
    setNoteSaving(false);
    if (ok) setNoteOpenId(null);
  }

  const emptyText: Record<View, string> = {
    today: "今天还没安排 ☀️ —— 在上面添加 todo（会自动标记今日），或把 ⭐重要 / 📋全部 里的todo 标为今日",
    important: "还没有重要 todo ⭐ —— 添加时勾选「重要」，或把现有todo 标为重要",
    all: "暂无 todo —— 在上面添加一个，或在主页随口说一句（AI 会自动识别 todo）",
    done: "还没有已完成的 todo ✓",
  };

  /** 菜单卡片单项：点击即关菜单再执行动作（danger 红、active 已开启徽标、busy 转圈文案） */
  const MenuItem = ({ icon, label, hint, extra, danger, active, disabled, busy, onClick }: {
    icon: string;
    label: string;
    hint?: string;
    extra?: string;
    danger?: boolean;
    active?: boolean;
    disabled?: boolean;
    busy?: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={() => {
        if (disabled) return;
        setMenuRow(null);
        onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition disabled:opacity-40 ${
        danger ? "text-danger hover:bg-rose-500/10" : active ? "text-warn hover:bg-wash" : "text-ink hover:bg-wash"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-sm leading-none">{busy ? "⏳" : icon}</span>
      <span className="min-w-0 flex-1">
        {label}
        {hint && <span className="block truncate text-[10px] text-ink-faint">{hint}</span>}
      </span>
      {extra && <span className="shrink-0 text-[10px] tabular-nums text-success">{extra}</span>}
      {active && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-warn">已开启</span>}
    </button>
  );

  const viewBar = (vertical: boolean) =>
    VIEWS.map(([v, label]) => (
      <FilterChip
        key={v}
        label={label}
        count={counts[v]}
        active={view === v}
        vertical={vertical}
        onClick={() => setView(v)}
        chipRef={
          vertical
            ? undefined
            : (el) => {
                chipRefs.current[v] = el;
              }
        }
      />
    ));

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

      {/* 移动端：横滑 chips（lg 以下）；右缘渐隐提示可滑动（隐藏滚动条时唯一的可供性） */}
      <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] lg:hidden">{viewBar(false)}</div>

      <div className="lg:grid lg:grid-cols-[190px_1fr] lg:gap-5">
        {/* PC：左侧智能列表栏 */}
        <aside className="hidden lg:block">
          <div className="glass sticky top-20 space-y-1 rounded-2xl p-2">{viewBar(true)}</div>
        </aside>

        {/* 主列表 */}
        <div className="min-w-0">
          {/* 添加任务行（已完成视图不显示）；N3：展开后点空白收起，有未提交内容轻提示 */}
          {view !== "done" && (
            <div
              ref={addRowRef}
              className="glass mb-3 rounded-2xl p-2.5 transition focus-within:border-sky-500/50"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-500 opacity-70" />
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  onFocus={() => setDraftOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) addTodo();
                  }}
                  placeholder="添加 todo，回车保存"
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
                  {spaces.length > 0 && (
                    <select
                      value={draft.spaceId}
                      onChange={(e) => setDraft({ ...draft, spaceId: e.target.value })}
                      title="关联目标空间"
                      className="rounded border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-sky-500"
                    >
                      <option value="">不关联空间</option>
                      {spaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.icon} {s.name}
                        </option>
                      ))}
                    </select>
                  )}
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
                // 已完成的任务不再展示过期/到期标签（截止时间对已完成的任务没有意义）
                const tag = t.status === "done" ? null : dueTag(t.due_at);
                const prog = childProgress(t.children);
                const isEditing = editingId === t.id;
                const open = expanded.has(t.id);
                const done = t.status === "done";
                return (
                  <li key={t.id} className="group rounded-xl px-2 py-1 transition hover:bg-elevated/60">
                    {isEditing ? (
                      /* ---- 行内编辑器（N3：点空白/Esc 取消，有改动轻提示） ---- */
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
                      </Dismissable>
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
                              onClick={() => toggleExpand(t.id)}
                              className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-ink-dim transition hover:text-accent"
                              title="行动进度"
                            >
                              {prog.n}/{prog.m}
                            </button>
                          )}
                          {tag && <span className={`shrink-0 text-xs ${tag.cls}`}>{tag.text}</span>}
                          <button
                            onClick={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 330), left: Math.max(8, r.right - 224) });
                              setMenuRow({ todo: t, isChild: false });
                            }}
                            title="更多操作"
                            className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover:block"
                          >
                            ⋯
                          </button>
                          {(t.children.length > 0) && (
                              <button
                              onClick={() => toggleExpand(t.id)}
                              title={open ? "收起行动" : "展开行动"}
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
                              const ctag = c.status === "done" ? null : dueTag(c.due_at);
                              const cDone = c.status === "done";
                              return (
                                <div key={c.id} className="group/child rounded-lg px-1.5 py-1 transition hover:bg-elevated/60">
                                  {noteOpenId === c.id ? (
                                    /* ---- 行动详情面板（N3：点空白/Esc 取消，有改动轻提示） ---- */
                                    <Dismissable
                                      onClose={() => {
                                        const dirty =
                                          noteTitle !== c.title ||
                                          noteText !== (c.note ?? "") ||
                                          noteDue !== isoToLocalInput(c.due_at) ||
                                          noteRepeat !== c.repeat_daily;
                                        if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
                                        setNoteOpenId(null);
                                      }}
                                      className="rounded-lg border border-sky-500/40 bg-elevated/60 p-2.5"
                                    >
                                      <input
                                        autoFocus
                                        value={noteTitle}
                                        onChange={(e) => setNoteTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.nativeEvent.isComposing) saveNote();
                                          if (e.key === "Escape") setNoteOpenId(null);
                                        }}
                                        className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-[13px] outline-none focus:border-sky-500"
                                        placeholder="标题"
                                      />
                                      <textarea
                                        value={noteText}
                                        onChange={(e) => setNoteText(e.target.value.slice(0, 1000))}
                                        rows={4}
                                        maxLength={1000}
                                        placeholder="详细内容（可选，记录细节/链接/备注，≤1000 字）"
                                        className="input-glow mt-2 w-full resize-none rounded border border-line-soft bg-surface/60 px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-ink-faint"
                                      />
                                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] tabular-nums text-ink-faint">{noteText.length}/1000</span>
                                        <input
                                          type="datetime-local"
                                          value={noteDue}
                                          onChange={(e) => setNoteDue(e.target.value)}
                                          title="截止时间（可清空）"
                                          className="rounded border border-line-strong bg-surface px-2 py-1 text-[12px] tabular-nums outline-none focus:border-sky-500"
                                        />
                                        <label
                                          title="每日重复：完成后次日 06:00 自动恢复未完成，并累积完成次数"
                                          className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11px] transition ${
                                            noteRepeat ? "bg-emerald-500/20 text-success" : "border border-line-soft text-ink-mute hover:text-ink"
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={noteRepeat}
                                            onChange={(e) => setNoteRepeat(e.target.checked)}
                                            className="h-3 w-3 accent-emerald-500"
                                          />
                                          🔁 每日{noteRepeat && noteDoneCount > 0 ? ` · 已完成 ×${noteDoneCount}` : ""}
                                        </label>
                                        <div className="ml-auto flex gap-2">
                                          <button onClick={() => setNoteOpenId(null)} className="rounded px-2.5 py-1 text-xs text-ink-mute hover:bg-soft">
                                            取消
                                          </button>
                                          <button
                                            onClick={saveNote}
                                            disabled={noteSaving || !noteTitle.trim()}
                                            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-50"
                                          >
                                            {noteSaving ? "保存中…" : "保存"}
                                          </button>
                                        </div>
                                      </div>
                                    </Dismissable>
                                  ) : (
                                    <div className="flex items-center gap-2.5">
                                      <TodoCircle size="sm" done={cDone} onClick={() => toggleDone(c)} />
                                      <span
                                        className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] ${cDone ? "text-ink-faint line-through" : ""}`}
                                        onClick={() => openNote(c)}
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
                                        onClick={(e) => {
                                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                          setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 300), left: Math.max(8, r.right - 224) });
                                          setMenuRow({ todo: c, isChild: true, parentTitle: t.title });
                                        }}
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
                            {subParentId === t.id && (
                              <div className="flex items-center gap-2.5 px-1.5 py-1">
                                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-line-strong" />
                                <input
                                  autoFocus
                                  value={subTitle}
                                  onChange={(e) => setSubTitle(e.target.value)}
                                  onBlur={() => {
                                    // blur 即"点空白"（N3）；有未提交内容轻提示
                                    if (subTitle.trim()) setMsg({ ok: true, text: "已取消，未保存" });
                                    setSubParentId(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.nativeEvent.isComposing) addSubtask(t.id);
                                    if (e.key === "Escape") setSubParentId(null);
                                  }}
                                  placeholder="行动，回车添加（Esc 结束）"
                                  maxLength={200}
                                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
                                />
                              </div>
                            )}
                            {t.children.length === 0 && subParentId !== t.id && (
                              <p className="px-1.5 py-1 text-[11px] text-ink-faint">还没有行动 —— 行右侧「⋯」里添加，或让 AI 拆解</p>
                            )}
                            {done && <p className="px-1.5 py-0.5 text-[11px] text-ink-faint">已完成的 todo 不可再添加行动</p>}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
              {view === "done" && (
                <li className="px-2 pt-3 text-center text-[11px] text-ink-faint">最多显示最近 200 条已完成的顶层 todo</li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* 行操作菜单卡片：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层） */}
      {menuRow &&
        createPortal(
          <Dismissable
            onClose={() => setMenuRow(null)}
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
            style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
          >
            {/* 移动端拖拽指示条 */}
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
            <p className="mb-1.5 flex items-center gap-1.5 px-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-dim">{menuRow.todo.title}</span>
              {menuRow.isChild && menuRow.parentTitle && (
                <span className="max-w-24 shrink-0 truncate text-[10px] text-ink-faint">{menuRow.parentTitle}</span>
              )}
            </p>
              <div className="space-y-0.5">
                {menuRow.isChild ? (
                  <>
                    <MenuItem icon="✏️" label="编辑标题 / 描述" onClick={() => openNote(menuRow.todo)} />
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="🔁"
                        label={menuRow.todo.repeat_daily ? "关闭每日重复" : "每日重复（次日 6 点恢复）"}
                        active={menuRow.todo.repeat_daily}
                        extra={menuRow.todo.repeat_done_count > 0 ? `已完成 ×${menuRow.todo.repeat_done_count}` : undefined}
                        onClick={() => patchTodo(menuRow.todo.id, { repeatDaily: !menuRow.todo.repeat_daily }, menuRow.todo.repeat_daily ? "已关闭每日重复" : "🔁 已设为每日重复")}
                      />
                    )}
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="✨"
                        label="AI 细化为更小行动"
                        hint="插入到该行动之后"
                        disabled={decomposingId === menuRow.todo.id}
                        busy={decomposingId === menuRow.todo.id}
                        onClick={() => decompose(menuRow.todo, true)}
                      />
                    )}
                    <MenuItem icon="🗑" label="删除行动" danger onClick={() => removeTodo(menuRow.todo, true)} />
                  </>
                ) : (
                  <>
                    <MenuItem icon="✏️" label="编辑标题与时间" onClick={() => startEdit(menuRow.todo)} />
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="⭐"
                        label={menuRow.todo.is_important ? "取消重要标记" : "标记为重要"}
                        active={menuRow.todo.is_important}
                        onClick={() => patchTodo(menuRow.todo.id, { important: !menuRow.todo.is_important }, menuRow.todo.is_important ? "已取消重要" : "⭐ 已标记为重要")}
                      />
                    )}
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="☀️"
                        label={menuRow.todo.today_tag_date ? "移出今日" : "标记为今日"}
                        hint="今日标记跨零点自动失效"
                        active={!!menuRow.todo.today_tag_date}
                        onClick={() => patchTodo(menuRow.todo.id, { today: !menuRow.todo.today_tag_date }, menuRow.todo.today_tag_date ? "已移出今日" : "☀️ 已加入今日")}
                      />
                    )}
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="＋"
                        label="添加行动"
                        onClick={() => {
                          setSubParentId(menuRow.todo.id);
                          setSubTitle("");
                          setExpanded((s) => new Set(s).add(menuRow.todo.id));
                        }}
                      />
                    )}
                    {!isDoneRow(menuRow.todo) && (
                      <MenuItem
                        icon="✨"
                        label="AI 拆解为可执行的行动"
                        disabled={decomposingId === menuRow.todo.id}
                        busy={decomposingId === menuRow.todo.id}
                        onClick={() => decompose(menuRow.todo, false)}
                      />
                    )}
                    {isDoneRow(menuRow.todo) && (
                      <MenuItem icon="↩️" label="恢复为未完成" onClick={() => patchTodo(menuRow.todo.id, { undone: true }, `↩️ 「${menuRow.todo.title}」已恢复`)} />
                    )}
                    <MenuItem icon="🗑" label="删除 todo" hint="其下行动一并删除" danger onClick={() => removeTodo(menuRow.todo, false)} />
                  </>
                )}
              </div>
          </Dismissable>,
          document.body,
        )}
    </div>
  );
}
