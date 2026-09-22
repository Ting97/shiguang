"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import Nav from "@/components/nav";
import { Dismissable } from "@/components/dismissable";
import { FilterChip } from "@/components/tag-chip";
import InlineRename from "@/components/inline-rename";
import SpaceReflections from "@/components/space-reflections";
import ReflectionEditor from "@/components/reflection-editor";
import SpacePicker from "@/components/space-picker";
import { TagChip } from "@/components/tag-chip";
import { TodoCircle, childProgress, dueTag, isoToLocalInput, localInputToIso } from "@/components/todo-bits";
import type { Activity, FeedMoment, Space, TodoItem, TodoRow } from "@/lib/types";

/**
 * 空间详情（REQ-001 R3）：空间头部（可编辑/归档/删除）→ 进度概览 →
 * 关联待办（含行动列表、✨AI 拆解、添加行动）→ 关联动态流。
 */

/** pg date 字段经 node-pg 序列化为 UTC ISO（北京时间零点 → 前一日 16:00Z），按北京日期还原 */
const bjDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
/** 北京今天（YYYY-MM-DD），用于判断目标是否已过期 */
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export default function Detail() {
  // 静态导出壳页的水合参数是构建期占位 "__shell__"，此时从真实地址解析 id（同 contacts/[id] 先例）
  const params = useParams<{ id: string }>();
  const id = !params?.id || params.id === "__shell__"
    ? (typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean)[1] ?? "" : "")
    : params.id;
  const [space, setSpace] = useState<Space | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // 已完成的关联 todo（默认收起展示）
  const [doneTodos, setDoneTodos] = useState<TodoItem[]>([]);
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 行动描述编辑（复用 note 字段；详情页只读展开）
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  // 行操作菜单卡片（点「⋯」弹出；桌面锚定浮层 / 移动端底部弹层）
  const [menuRow, setMenuRow] = useState<{ todo: TodoRow; isChild: boolean } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // 数据加载失败态（网络抖动/接口异常）：给出重试入口，避免永远停在"加载中"
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // N2：分区 tab + 感悟编辑器
  const [tab, setTab] = useState<"todo" | "reflection" | "moments">("todo");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingReflection, setEditingReflection] = useState<{ id: string; content: string } | null>(null);
  const [refEditorBusy, setRefEditorBusy] = useState(false);
  // N1：行级空间关联浮层（待办行）
  const [pickerRow, setPickerRow] = useState<{ id: string; spaceId: string | null } | null>(null);
  const [allSpaces, setAllSpaces] = useState<Space[]>([]);
  // 目标到期时间就地编辑（头部 ⏳ 日期可点击调整/清除）
  const [dateEdit, setDateEdit] = useState(false);
  const [dateDraft, setDateDraft] = useState("");
  // 空间操作菜单（⋯ 收纳归档/删除）
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [spaceMenuPos, setSpaceMenuPos] = useState<{ top: number; left: number } | null>(null);
  // 行内编辑器（与日程 todo-board 同交互）：顶层 todo 标题/截止/分类
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");
  // 行动详情面板（点行动标题展开编辑）：标题+描述+截止+每日重复（取代原只读描述展开）
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDue, setNoteDue] = useState("");
  const [noteRepeat, setNoteRepeat] = useState(false);
  const [noteDoneCount, setNoteDoneCount] = useState(0);
  // 活动分类（编辑器下拉用）
  const [activities, setActivities] = useState<Activity[]>([]);
  // 「关联已有」浮层：浏览未关联空间的顶层 TODO/独立行动并关联到本空间
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<TodoItem[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const sr = await fetch("/api/spaces");
      if (sr.status === 401) {
        location.href = "/login";
        return;
      }
      const sj = await sr.json();
      setAllSpaces((sj.spaces as Space[]) ?? []);
      const s = (sj.spaces as Space[]).find((x) => x.id === id);
      if (!s) {
        setNotFound(true);
        return;
      }
      setSpace(s);
      // 该空间的待办（全视图取全部再前端过滤）
      const tr = await fetch("/api/todos?view=all");
      if (tr.ok) {
        const tj = await tr.json();
        setTodos((tj.todos as TodoItem[]).filter((t) => t.space_id === id));
      }
      // 已完成的关联 todo（done 视图按完成时间倒序）
      const dr = await fetch("/api/todos?view=done");
      if (dr.ok) {
        const dj = await dr.json();
        setDoneTodos(((dj.todos as TodoItem[]) ?? []).filter((t) => t.space_id === id));
      }
      const fr = await fetch("/api/feed?limit=20&spaceId=" + id);
      if (fr.ok) setMoments((await fr.json()).moments as FeedMoment[]);
      const ar = await fetch("/api/activities");
      if (ar.ok) setActivities((await ar.json()).activities ?? []);
    } catch (e) {
      // 网络抖动/接口异常不能停在加载态（历史 bug：无 catch 时永远"加载中"只能强刷）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  async function addTodo() {
    const t = newTodo.trim();
    if (!t) return;
    const r = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, spaceId: id }),
    });
    if (r.ok) {
      setNewTodo("");
      await load();
    } else {
      const j = await r.json();
      setMsg({ ok: false, text: j.error ?? "添加失败" });
    }
  }

  async function patchTodo(todoId: string, body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusyId(todoId);
    try {
      const r = await fetch(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json();
        setMsg({ ok: false, text: j.error ?? "操作失败" });
        return false;
      }
      setMsg({ ok: true, text: okText });
      await load();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  async function removeTodo(todoId: string, title: string) {
    if (!window.confirm(`删除「${title}」？\n其下行动会一并删除。`)) return;
    await fetch(`/api/todos/${todoId}`, { method: "DELETE" });
    setMsg({ ok: true, text: "已删除" });
    await load();
  }

  /** AI 拆解：待办→≤10 行动（已有未完成时询问追加/重生成）；行动→≤3 同级细化（插入其后） */
  async function decompose(t: { id: string; title: string; isAction: boolean }) {
    const key = t.id;
    setBusyId(key);
    try {
      const askMode = !t.isAction;
      let mode: string | undefined;
      if (askMode) {
        const parent = todos.find((x) => x.id === t.id);
        const pending = parent?.children.filter((c) => c.status === "pending").length ?? 0;
        if (pending > 0) {
          const yes = window.confirm(`「${t.title}」已有 ${pending} 个未完成行动。\n\n确定 = 重新生成（清空未完成，已完成保留）\n取消 = 改为追加到末尾\n\n（追加请点取消后在弹窗选择）`);
          mode = yes ? "replace" : "append";
          if (!yes) {
            // append 需要再次确认语义
            mode = "append";
          }
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
      setMsg({ ok: true, text: `✨ AI 拆出 ${j.actions.length} 个行动${t.isAction ? "，已插入原行动之后" : ""}` });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(status: "active" | "archived") {
    if (!space) return;
    await fetch(`/api/spaces/${space.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    location.href = "/spaces";
  }

  /** 调整/清除目标到期时间（头部就地编辑；null=清除） */
  async function saveTargetDate(v: string | null): Promise<boolean> {
    const r = await fetch(`/api/spaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetDate: v }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}) as { error?: string });
      setMsg({ ok: false, text: j.error ?? "保存失败" });
      return false;
    }
    setSpace((s) => (s ? { ...s, target_date: v } : s));
    setAllSpaces((list) => list.map((x) => (x.id === id ? { ...x, target_date: v } : x)));
    setMsg({ ok: true, text: v ? `⏳ 目标到期时间已调整为 ${v}` : "目标到期时间已清除" });
    return true;
  }

  /** 行内编辑（与日程 todo-board 同交互）：顶层 todo 标题/截止/分类 */
  function startEdit(t: TodoRow) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(isoToLocalInput(t.due_at));
    setEditActivity(t.activity_id ?? "other");
  }

  async function saveEdit(): Promise<boolean> {
    if (!editingId || !editTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return false;
    }
    const ok = await patchTodo(editingId, {
      title: editTitle.trim(),
      dueAt: localInputToIso(editDue),
      activityId: editActivity,
    }, "💾 已保存");
    if (ok) setEditingId(null);
    return ok;
  }

  /** 行动详情面板：标题+描述+截止+每日重复（与 todo-board 行动面板同交互） */
  function openNote(c: TodoRow) {
    setNoteOpen(c.id);
    setNoteTitle(c.title);
    setNoteText(c.note ?? "");
    setNoteDue(isoToLocalInput(c.due_at));
    setNoteRepeat(c.repeat_daily);
    setNoteDoneCount(c.repeat_done_count);
  }

  async function saveNote(): Promise<boolean> {
    if (!noteOpen || !noteTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return false;
    }
    const ok = await patchTodo(noteOpen, {
      title: noteTitle.trim(),
      note: noteText.trim() ? noteText.trim() : null,
      dueAt: localInputToIso(noteDue),
      repeatDaily: noteRepeat,
    }, "💾 行动已保存");
    if (ok) setNoteOpen(null);
    return ok;
  }

  /** 打开「关联已有」浮层：拉取未关联空间且未完成的顶层 TODO/独立行动（有父行动随父走，不在顶层） */
  async function openLinkPicker() {
    setLinkLoading(true);
    try {
      const r = await fetch("/api/todos?view=all");
      if (!r.ok) {
        setMsg({ ok: false, text: "加载失败，请稍后再试" });
        return;
      }
      const j = await r.json();
      setLinkItems(((j.todos as TodoItem[]) ?? []).filter((t) => !t.space_id && t.status === "pending"));
      setLinkQuery("");
      setLinkOpen(true);
    } catch {
      setMsg({ ok: false, text: "加载失败，请稍后再试" });
    } finally {
      setLinkLoading(false);
    }
  }

  /** 浮层内关联一条到本空间（成功后从浮层移除，可连续关联多条） */
  async function linkExisting(todoId: string) {
    const ok = await patchTodo(todoId, { spaceId: id }, "🎯 已关联到本空间");
    if (ok) setLinkItems((list) => list.filter((x) => x.id !== todoId));
  }

  /** N1：行级关联/切换/移除空间 */
  async function pickSpace(todoId: string, target: string | null) {
    setPickerRow(null);
    const r = await fetch(`/api/todos/${todoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId: target }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}) as { error?: string });
      setMsg({ ok: false, text: j.error ?? "关联失败" });
      return;
    }
    setMsg({ ok: true, text: target ? "🎯 已关联空间" : "已移除空间归属" });
    await load();
  }

  /** N2：保存感悟（新建/编辑） */
  async function saveReflection(content: string): Promise<boolean> {
    setRefEditorBusy(true);
    try {
      const url = editingReflection
        ? `/api/spaces/${id}/reflections/${editingReflection.id}`
        : `/api/spaces/${id}/reflections`;
      const r = await fetch(url, {
        method: editingReflection ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}) as { error?: string });
        setMsg({ ok: false, text: j.error ?? "保存失败" });
        return false;
      }
      setMsg({ ok: true, text: editingReflection ? "✏️ 感悟已更新" : "📝 感悟已保存" });
      setEditorOpen(false);
      await load();
      return true;
    } finally {
      setRefEditorBusy(false);
    }
  }

  async function removeSpace() {
    if (!space) return;
    const refN = space.reflection_count ?? 0;
    if (!window.confirm(`删除空间「${space.name}」？\n含 ${refN} 篇感悟（将一并删除）；${space.todo_total ?? 0} 条关联 todo、${space.entry_count ?? 0} 条动态仅解除归属。`)) return;
    await fetch(`/api/spaces/${space.id}`, { method: "DELETE" });
    location.href = "/spaces";
  }

  if (notFound) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
          <Nav />
          <div className="glass mt-10 rounded-2xl p-10 text-center">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 text-sm">空间不存在或已删除</p>
            <Link href="/spaces" className="btn-primary mt-4 inline-block rounded-xl px-5 py-2 text-sm">
              返回目标列表
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!space) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
          <Nav />
          {loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button
                onClick={() => {
                  setSpace(null);
                  void load();
                }}
                className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs"
              >
                重试
              </button>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
          )}
        </div>
      </main>
    );
  }

  const todoProgress = space.todo_total ? Math.round((space.todo_done ?? 0) / space.todo_total * 100) : null;
  const actionProgress = space.action_total ? Math.round((space.action_done ?? 0) / space.action_total * 100) : null;
  const days = space.started_at ? Math.max(1, Math.ceil((Date.now() - new Date(bjDate(space.started_at) + "T00:00:00+08:00").getTime()) / 86_400_000)) : null;

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-4xl px-5 pb-16 pt-8">
        <Nav />
        {msg && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"}`}>
            {msg.text}
          </div>
        )}

        {/* 空间头部 */}
        <div className="glass mb-4 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl" style={{ backgroundColor: `${space.color}26` }}>
              {space.icon}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-ink">
                <InlineRename
                  value={space.name}
                  onSave={async (name) => {
                    const r = await fetch(`/api/spaces/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name }),
                    });
                    if (!r.ok) {
                      const j = await r.json().catch(() => ({}) as { error?: string });
                      setMsg({ ok: false, text: j.error ?? "重命名失败" });
                      return false;
                    }
                    setSpace({ ...space, name });
                    setMsg({ ok: true, text: "已重命名" });
                    return true;
                  }}
                />
              </h1>
              {space.description && <p className="mt-1 text-xs leading-relaxed text-ink-mute">{space.description}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-dim">
                {space.started_at && <span>{bjDate(space.started_at)} 开始</span>}
                {dateEdit ? (
                  <Dismissable onClose={() => setDateEdit(false)} className="inline-flex items-center gap-1.5">
                    <input
                      type="date"
                      autoFocus
                      value={dateDraft}
                      onChange={(e) => setDateDraft(e.target.value)}
                      className="rounded-lg border border-sky-500/50 bg-elevated px-1.5 py-0.5 text-[11px] text-ink"
                    />
                    <button
                      onClick={async () => {
                        if (await saveTargetDate(dateDraft || null)) setDateEdit(false);
                      }}
                      className="rounded-lg bg-sky-500/20 px-1.5 py-0.5 text-accent transition hover:bg-sky-500/30"
                    >
                      保存
                    </button>
                    {space.target_date && (
                      <button
                        onClick={async () => {
                          if (await saveTargetDate(null)) setDateEdit(false);
                        }}
                        className="rounded-lg px-1.5 py-0.5 text-ink-mute transition hover:bg-soft hover:text-danger"
                      >
                        清除
                      </button>
                    )}
                  </Dismissable>
                ) : (
                  <button
                    onClick={() => {
                      setDateDraft(space.target_date ? bjDate(space.target_date) : "");
                      setDateEdit(true);
                    }}
                    className="-mx-1 rounded px-1 text-left transition hover:bg-soft hover:text-accent"
                    title={space.target_date ? "点击调整目标到期时间" : "设置目标到期时间"}
                  >
                    {space.target_date ? (
                      <span className={bjDate(space.target_date) < bjToday() ? "text-danger" : undefined}>
                        ⏳ {bjDate(space.target_date)}
                        {bjDate(space.target_date) < bjToday() && " 已过期"}
                      </span>
                    ) : (
                      <span className="text-ink-faint">＋ 设目标</span>
                    )}
                  </button>
                )}
                {days != null && <span>第 {days} 天</span>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link href="/spaces" className="rounded px-2 py-1 text-xs text-ink-mute transition hover:bg-soft hover:text-accent">
                ← 列表
              </Link>
              <button
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSpaceMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 240), left: Math.max(8, r.right - 224) });
                  setSpaceMenu(true);
                }}
                title="更多操作"
                className="rounded px-2 py-1 text-base leading-none text-ink-dim transition hover:bg-soft hover:text-ink"
              >
                ⋯
              </button>
            </div>
          </div>
          {/* 进度概览 */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-ink-faint">
                <span>todo 完成率</span>
                <span className="tabular-nums">{todoProgress == null ? "—" : `${space.todo_done}/${space.todo_total} · ${todoProgress}%`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${todoProgress ?? 0}%`, backgroundColor: space.color }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-ink-faint">
                <span>行动完成率</span>
                <span className="tabular-nums">{actionProgress == null ? "—" : `${space.action_done}/${space.action_total} · ${actionProgress}%`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${actionProgress ?? 0}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* 分区 tab（REQ-002 N2）：TODO·行动 / 感悟 / 动态 */}
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip label="TODO·行动" count={todos.length} active={tab === "todo"} onClick={() => setTab("todo")} />
          <FilterChip label="感悟" count={space.reflection_count ?? 0} active={tab === "reflection"} onClick={() => setTab("reflection")} />
          <FilterChip label="动态" count={moments.length} active={tab === "moments"} onClick={() => setTab("moments")} />
        </div>

        {/* 关联 TODO·行动 */}
        {tab === "todo" && (
        <section className="glass mb-4 rounded-2xl p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <TagChip icon="📋" label="TODO·行动" tone="sky" />
            <span className="text-xs font-normal text-ink-dim">{todos.length} 条</span>
            <button
              onClick={() => void openLinkPicker()}
              className="ml-auto rounded-lg border border-line-soft px-2.5 py-1 text-[11px] font-normal text-ink-mute transition hover:border-sky-500/50 hover:text-accent"
            >
              🔗 关联已有
            </button>
          </h2>
          {/* 添加 todo */}
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 focus-within:border-sky-500/60">
            <span className="text-sm opacity-60">＋</span>
            <input
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void addTodo();
              }}
              placeholder="添加服务于该空间的 TODO，回车保存"
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
            />
          </div>

          {todos.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">还没有 TODO/行动 —— 在上面添加、用「关联已有」归属未关联的，或在「日程 · todo」里选择该空间</p>
          ) : (
            <ul className="space-y-2">
              {todos.map((t) => {
                const done = t.status === "done";
                const open = expanded.has(t.id);
                const tag = done ? null : dueTag(t.due_at);
                return (
                  <li key={t.id} className="rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
                    {editingId === t.id ? (
                      /* ---- 行内编辑器（与日程 todo-board 同交互；点空白/Esc 取消，有改动轻提示） ---- */
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
                    ) : (
                      <>
                    <div className="group flex items-center gap-2.5">
                      <TodoCircle size="md" done={done} onClick={() => patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️「${t.title}」已恢复` : `✅「${t.title}」已完成`)} />
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
                        onClick={() => decompose({ id: t.id, title: t.title, isAction: false })}
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
                      {t.children.length > 0 && (
                        <button
                          onClick={() => setExpanded((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                          className={`shrink-0 text-[10px] text-ink-mute transition-transform ${open ? "rotate-180" : ""}`}
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
                              <TodoCircle size="sm" done={cDone} onClick={() => patchTodo(c.id, cDone ? { undone: true } : { done: true }, cDone ? "↩️ 已恢复" : "✅ 已完成")}/>
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
                      return (
                        <Dismissable
                          onClose={() => {
                            const dirty =
                              noteTitle !== c.title ||
                              noteText !== (c.note ?? "") ||
                              noteDue !== isoToLocalInput(c.due_at) ||
                              noteRepeat !== c.repeat_daily;
                            if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
                            setNoteOpen(null);
                          }}
                          className="ml-8 mt-1 rounded-lg border border-sky-500/40 bg-elevated/60 p-2.5"
                        >
                          <input
                            autoFocus
                            value={noteTitle}
                            onChange={(e) => setNoteTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveNote();
                              if (e.key === "Escape") setNoteOpen(null);
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
                              <button onClick={() => setNoteOpen(null)} className="rounded px-2.5 py-1 text-xs text-ink-mute hover:bg-soft">
                                取消
                              </button>
                              <button
                                onClick={() => void saveNote()}
                                disabled={!noteTitle.trim()}
                                className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-50"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        </Dismissable>
                      );
                    })()}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 已完成（默认收起，可展开查看/恢复） */}
          {doneTodos.length > 0 && (
            <details className="group mt-3 border-t border-line-soft pt-2">
              <summary className="cursor-pointer select-none list-none text-[11px] text-ink-faint transition hover:text-ink-mute">
                ✓ 已完成（{doneTodos.length}）<span className="ml-1 inline-block transition-transform group-open:rotate-90">▸</span>
              </summary>
              <ul className="mt-1.5 space-y-0.5">
                {doneTodos.map((t) => (
                  <li key={t.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition hover:bg-elevated/60">
                    <span className="shrink-0 text-success">✓</span>
                    <span className="min-w-0 flex-1 truncate text-ink-faint line-through" title={t.title}>
                      {t.title}
                    </span>
                    {t.children.length > 0 && (
                      <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                        {(() => { const p = childProgress(t.children); return p ? `${p.n}/${p.m}` : ""; })()}
                      </span>
                    )}
                    {t.done_at && <span className="shrink-0 text-[10px] text-ink-faint">{bjDate(t.done_at).slice(5)} 完成</span>}
                    <button
                      onClick={() => patchTodo(t.id, { undone: true }, `↩️「${t.title}」已恢复`)}
                      title="恢复为未完成"
                      className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-dim transition hover:text-accent group-hover:block"
                    >
                      ↩️
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        )}

        {/* 感悟（REQ-002 N2） */}
        {tab === "reflection" && (
          <div className="mb-4">
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => {
                  setEditingReflection(null);
                  setEditorOpen(true);
                }}
                className="btn-primary rounded-xl px-4 py-2 text-sm font-medium"
              >
                ✍️ 写感悟
              </button>
            </div>
            <SpaceReflections
              spaceId={id}
              notify={setMsg}
              onChanged={() => void load()}
              onEdit={({ id: rid }) => {
                // 打开编辑器前拉取全文
                void (async () => {
                  const r = await fetch(`/api/spaces/${id}/reflections/${rid}`);
                  const j = await r.json();
                  if (!r.ok) {
                    setMsg({ ok: false, text: j.error ?? "全文加载失败" });
                    return;
                  }
                  setEditingReflection({ id: rid, content: j.reflection.content });
                  setEditorOpen(true);
                })();
              }}
            />
          </div>
        )}

        {/* 关联动态 */}
        {tab === "moments" && (
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <TagChip icon="🌱" label="相关动态" tone="emerald" />
            <span className="text-xs font-normal text-ink-dim">{moments.length} 条</span>
          </h2>
          {moments.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">
              还没有归属该空间的动态 —— 发布时 AI 会自动归类，也可在动态卡片菜单手动归属
            </p>
          ) : (
            <ul className="space-y-2">
              {moments.map((m) => (
                <li key={m.id} className="rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
                  <p className="text-[10px] text-ink-faint">{new Date(m.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{m.raw_text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}

        {/* 行操作菜单卡片：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层）；点空白关闭由 useDismiss 处理（N3） */}
        {/* 关联已有 TODO/行动浮层（桌面居中 / 移动端底部弹层） */}
        {linkOpen &&
          createPortal(
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
          )}

        {/* 空间操作菜单（⋯ 收纳归档/删除；桌面锚定浮层 / 移动端底部弹层） */}
        {spaceMenu && space &&
          createPortal(
            <Dismissable
              onClose={() => setSpaceMenu(false)}
              className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
              style={spaceMenuPos ? { top: spaceMenuPos.top, left: spaceMenuPos.left } : undefined}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
              <p className="mb-1.5 truncate px-1.5 text-[11px] font-medium text-ink-dim">{space.name}</p>
              <div className="space-y-0.5">
                {space.status === "archived" ? (
                  <button
                    onClick={() => setStatus("active")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
                  >
                    <span className="w-5 shrink-0 text-center text-sm leading-none">📤</span>
                    <span className="min-w-0 flex-1">恢复空间</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus("archived")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-warn transition hover:bg-wash"
                  >
                    <span className="w-5 shrink-0 text-center text-sm leading-none">📦</span>
                    <span className="min-w-0 flex-1">归档空间</span>
                  </button>
                )}
                <button
                  onClick={removeSpace}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10"
                >
                  <span className="w-5 shrink-0 text-center text-sm leading-none">🗑</span>
                  <span className="min-w-0 flex-1">删除空间</span>
                </button>
              </div>
            </Dismissable>,
            document.body,
          )}

        {menuRow &&
          createPortal(
            <Dismissable
              onClose={() => setMenuRow(null)}
              className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
              style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
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
          )}

        {/* N2 感悟编辑器（底部抽屉，N3 点空白取消） */}
        <ReflectionEditor
          open={editorOpen}
          initial={editingReflection?.content ?? ""}
          busy={refEditorBusy}
          notify={setMsg}
          onCancel={() => setEditorOpen(false)}
          onSave={saveReflection}
        />

        {/* N1 行级空间关联浮层 */}
        {pickerRow &&
          createPortal(
            <SpacePicker
              spaces={allSpaces}
              currentId={pickerRow.spaceId}
              busy={false}
              onPick={(sid) => void pickSpace(pickerRow.id, sid)}
              onRemove={() => void pickSpace(pickerRow.id, null)}
              onClose={() => setPickerRow(null)}
            />,
            document.body,
          )}
      </div>
    </main>
  );
}
