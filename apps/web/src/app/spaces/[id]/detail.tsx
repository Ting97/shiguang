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
import { TodoCircle, childProgress, dueTag, zhTime } from "@/components/todo-bits";
import type { FeedMoment, Space, TodoItem, TodoRow } from "@/lib/types";

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
      const fr = await fetch("/api/feed?limit=20&spaceId=" + id);
      if (fr.ok) setMoments((await fr.json()).moments as FeedMoment[]);
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

  async function patchTodo(todoId: string, body: Record<string, unknown>, okText: string) {
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
        return;
      }
      setMsg({ ok: true, text: okText });
      await load();
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
            <div className="flex shrink-0 flex-col gap-1">
              <Link href="/spaces" className="rounded px-2 py-1 text-right text-xs text-ink-mute hover:bg-soft hover:text-accent">
                ← 列表
              </Link>
              <button onClick={() => setStatus("archived")} className="rounded px-2 py-1 text-right text-xs text-ink-mute hover:bg-soft hover:text-warn">
                归档
              </button>
              <button onClick={removeSpace} className="rounded px-2 py-1 text-right text-xs text-ink-mute hover:bg-soft hover:text-danger">
                删除
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

        {/* 分区 tab（REQ-002 N2）：待办 / 感悟 / 动态 */}
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip label="待办" count={todos.length} active={tab === "todo"} onClick={() => setTab("todo")} />
          <FilterChip label="感悟" count={space.reflection_count ?? 0} active={tab === "reflection"} onClick={() => setTab("reflection")} />
          <FilterChip label="动态" count={moments.length} active={tab === "moments"} onClick={() => setTab("moments")} />
        </div>

        {/* 关联 todo */}
        {tab === "todo" && (
        <section className="glass mb-4 rounded-2xl p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <TagChip icon="📋" label="关联 todo" tone="sky" />
            <span className="text-xs font-normal text-ink-dim">{todos.length} 条</span>
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
              placeholder="添加服务于该空间的 todo，回车保存"
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
            />
          </div>

          {todos.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">还没有关联 todo —— 在上面添加，或在「日程 · todo」里选择该空间</p>
          ) : (
            <ul className="space-y-2">
              {todos.map((t) => {
                const done = t.status === "done";
                const open = expanded.has(t.id);
                const tag = done ? null : dueTag(t.due_at);
                return (
                  <li key={t.id} className="rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
                    <div className="group flex items-center gap-2.5">
                      <TodoCircle size="md" done={done} onClick={() => patchTodo(t.id, { done: true }, `✅「${t.title}」已完成`)} />
                      <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-ink-faint line-through" : ""}`}>{t.title}</span>
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
                              <TodoCircle size="sm" done={cDone} onClick={() => patchTodo(c.id, { done: true }, `✅ 已完成`)}/>
                              <span className={`min-w-0 flex-1 cursor-pointer truncate text-[13px] ${cDone ? "text-ink-faint line-through" : ""}`} onClick={() => setNoteOpen(noteOpen === c.id ? null : c.id)}>
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
                    {/* 行动描述只读展开 */}
                    {noteOpen && t.children.some((c) => c.id === noteOpen) && (() => {
                      const c = t.children.find((x) => x.id === noteOpen)!;
                      return (
                        <Dismissable onClose={() => setNoteOpen(null)} className="ml-8 mt-1 rounded-lg border border-sky-500/30 bg-elevated/60 p-2.5">
                          <p className="text-[10px] text-ink-faint">{c.title} · 描述</p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{c.note || "（无描述）"}</p>
                          {c.done_at && <p className="mt-1 text-[10px] text-ink-faint">完成于 {zhTime(c.done_at)}</p>}
                        </Dismissable>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>
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
