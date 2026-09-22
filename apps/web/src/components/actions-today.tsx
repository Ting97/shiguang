"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TodoLogo from "./todo-logo";
import { TodoCircle, dueTag } from "./todo-bits";
import { Dismissable } from "./dismissable";
import type { TodayAction } from "@/lib/types";

/**
 * 首页「今日行动清单」（REQ-001 R3 + REQ-002 N6）：
 * - 展示行动级条目：① 🔁 每日重复；② 独立行动标记今日/今日到期；③ 有父行动随父待办今日
 * - N6：顶部「添加行动」输入行——回车即建独立行动（默认标记今日），做完勾掉
 * - N3：行内编辑器点空白/Esc 取消（有改动轻提示）
 * - 数据自取 /api/todos?view=today-actions（06:00 记录日惰性日切在服务端读取时触发）
 */
export default function ActionsToday({ notify }: { notify: (e: { ok: boolean; text: string } | null) => void }) {
  const [actions, setActions] = useState<TodayAction[] | null>(null);
  const [_busyId, setBusyId] = useState<string | null>(null);
  // N6 添加行动
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  // N6/N3 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/todos?view=today-actions");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "加载失败");
      setActions(j.actions ?? []);
    } catch (e) {
      setActions([]);
      notify({ ok: false, text: `行动清单加载失败：${e instanceof Error ? e.message : e}` });
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  /** N6：直接添加独立行动（默认标记今日，当日出现在清单） */
  async function addAction() {
    const t = newTitle.trim();
    if (!t || adding) return;
    setAdding(true);
    try {
      const r = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, kind: "action", today: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "创建失败");
      setNewTitle("");
      notify({ ok: true, text: `⚡ 已添加行动「${t}」` });
      await load();
    } catch (e) {
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(a: TodayAction) {
    const done = a.status === "done";
    setBusyId(a.id);
    await fetch(`/api/todos/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(done ? { undone: true } : { done: true }),
    });
    setBusyId(null);
    if (a.repeat_daily && !done) {
      notify({ ok: true, text: `🎉 完成「${a.title}」，已坚持 ×${a.repeat_done_count + 1}` });
    }
    await load();
  }

  /** N6：删除行动（独立/有父皆可，confirm 确认） */
  async function removeAction(a: TodayAction) {
    if (!window.confirm(`删除行动「${a.title}」？`)) return;
    await fetch(`/api/todos/${a.id}`, { method: "DELETE" });
    notify({ ok: true, text: "🗑 行动已删除" });
    await load();
  }

  /** N6/N3：行内编辑（标题+截止），Enter 保存、点空白/Esc 取消 */
  function startEdit(a: TodayAction) {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditDue(
      a.due_at
        ? (() => {
            const d = new Date(a.due_at);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          })()
        : "",
    );
    setTimeout(() => editInputRef.current?.focus(), 60);
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) return;
    await fetch(`/api/todos/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim(),
        dueAt: editDue ? new Date(editDue).toISOString() : null,
      }),
    });
    setEditingId(null);
    await load();
  }

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  const done = (actions ?? []).filter((a) => a.status === "done");

  /** 行动行（独立行动无父上下文行） */
  function ActionRow({ a }: { a: TodayAction }) {
    const tag = dueTag(a.due_at) ?? dueTag(a.parent_due);
    return (
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink">{a.title}</span>
          {!a.parent_title && (
            <span className="shrink-0 rounded-lg bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-medium text-ink-dim" title="独立行动（不属于任何 todo）">
              行动
            </span>
          )}
          {a.repeat_daily && (
            <span className="shrink-0 rounded-lg bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-success" title="每日重复">
              🔁 {a.repeat_done_count > 0 ? `×${a.repeat_done_count}` : ""}
            </span>
          )}
          {a.note && <span className="shrink-0 text-[10px] text-ink-faint" title="有描述">📄</span>}
        </p>
        {(a.parent_title || tag) && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            {a.parent_title && <span className="min-w-0 truncate">来自「{a.parent_title}」</span>}
            {tag && <span className={`shrink-0 ${tag.cls}`}>{tag.text}</span>}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="glass mb-5 rounded-2xl p-5" id="actions">
      {/* 标题行 */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <TodoLogo size={17} />
          <span>今日行动</span>
          {(actions?.length ?? 0) > 0 && (
            <span className="whitespace-nowrap text-xs font-normal text-ink-dim">
              {done.length}/{actions!.length} 完成
            </span>
          )}
        </h2>
        <a href="/schedule?tab=todo" className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-sky-500/10">
          规划 →
        </a>
      </div>

      {actions === null ? (
        <p className="py-2 text-xs text-ink-dim">加载中…</p>
      ) : (
        <>
          {/* N6：添加行动行（回车即建，默认标记今日） */}
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-2.5 py-2 transition focus-within:border-sky-500/60">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-500 opacity-70" />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void addAction();
              }}
              maxLength={200}
              placeholder="添加行动，回车保存（自动标记今日）"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
            />
            {newTitle.trim() && (
              <button
                onClick={() => void addAction()}
                disabled={adding}
                className="btn-primary shrink-0 rounded-lg px-3 py-1 text-[11px] font-medium disabled:opacity-50"
              >
                {adding ? "保存中…" : "添加"}
              </button>
            )}
          </div>

          {pending.length === 0 && done.length === 0 ? (
            <div className="py-2 text-center">
              <p className="text-xs text-ink-dim">今天还没有行动 —— 在上面直接添加一条，把 todo 标为今日（☀️），或在 todo 里 ✨ 拆解出可执行的行动</p>
              <a href="/schedule?tab=todo" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
                去「日程 · todo」规划 →
              </a>
            </div>
          ) : (
            <>
              <ul className="space-y-0.5">
                {pending.map((a) => {
                  // 到期提示：行动自身优先，父待办兜底（独立行动只有自身 due）
                  const _tag = dueTag(a.due_at) ?? dueTag(a.parent_due);
                  const isEditing = editingId === a.id;
                  return (
                    <li key={a.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-elevated/60">
                      {isEditing ? (
                        /* N3/N6 行内编辑：标题 + 截止；点空白/Esc 取消 */
                        <Dismissable
                          onClose={() => {
                            const dirty = editTitle !== a.title || editDue !== (a.due_at ? new Date(a.due_at).toISOString().slice(0, 16) : "");
                            if (dirty) notify({ ok: true, text: "已取消，未保存" });
                            setEditingId(null);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-sky-500/40 bg-elevated/60 p-2"
                        >
                          <input
                            ref={editInputRef}
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveEdit();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
                          />
                          <div className="mt-1.5 flex items-center gap-2">
                            <input
                              type="datetime-local"
                              value={editDue}
                              onChange={(e) => setEditDue(e.target.value)}
                              className="rounded border border-line-strong bg-surface px-2 py-1 text-[11px] tabular-nums outline-none focus:border-sky-500"
                            />
                            <div className="ml-auto flex gap-2">
                              <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
                              <button onClick={() => void saveEdit()} disabled={!editTitle.trim()} className="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-50">保存</button>
                            </div>
                          </div>
                        </Dismissable>
                      ) : (
                        <>
                          <TodoCircle size="md" done={false} onClick={() => toggleDone(a)} />
                          <ActionRow a={a} />
                          {/* N6 行操作（hover 显 / 触屏常显） */}
                          <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover:flex">
                            <button onClick={() => startEdit(a)} title="编辑行动" className="rounded px-1.5 py-0.5 text-xs text-ink-mute opacity-70 transition hover:bg-soft hover:text-ink">✏️</button>
                            <button onClick={() => void removeAction(a)} title="删除行动" className="rounded px-1.5 py-0.5 text-xs text-ink-mute opacity-70 transition hover:bg-soft hover:text-danger">🗑</button>
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* 今日已完成 */}
              {done.length > 0 && (
                <details className="mt-2 border-t border-line-soft pt-2">
                  <summary className="cursor-pointer text-xs text-ink-dim">今日已完成 {done.length} 项（可恢复）</summary>
                  <ul className="mt-1.5 space-y-1">
                    {done.map((a) => (
                      <li key={a.id} className="group flex items-center gap-3 rounded-lg px-2 py-1">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-[9px] text-white">✓</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-dim line-through">{a.title}</span>
                        {a.repeat_daily && a.repeat_done_count > 0 && (
                          <span className="shrink-0 text-[10px] text-success">×{a.repeat_done_count}</span>
                        )}
                        <button
                          onClick={() => toggleDone(a)}
                          title="恢复为未完成"
                          className="row-actions hidden shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-warn group-hover:block"
                        >
                          ↩️
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
