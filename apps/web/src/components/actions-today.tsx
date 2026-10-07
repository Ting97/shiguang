"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TodoLogo from "./todo-logo";
import { TodoCircle, dueTag, isoToLocalInput, localInputToIso } from "./todo-bits";
import { Dismissable } from "./dismissable";
import { TodoRowMenu } from "@/components/todo";
import { confirmDialog } from "@/shared/ui/confirm";
import type { TodayAction } from "@/lib/types";
import { api } from "@/shared/api";
import { ArrowRight, Check, Ellipsis, FileText, Repeat, RotateCcw } from "lucide-react";

/**
 * 首页「今日行动清单」（REQ-001 R3 + REQ-002 N6）：
 * - 展示行动级条目：① 🔁 每日重复；② 独立行动标记今日/今日到期；③ 有父行动随父待办今日
 * - N6：顶部「添加行动」输入行——回车即建独立行动（默认标记今日），做完勾掉
 * - N3：行内编辑器点空白/Esc 取消（有改动轻提示）
 * - 数据自取 /api/todos?view=today-actions（06:00 记录日惰性日切在服务端读取时触发）
 */
/** 行动行（独立行动无父上下文行）：模块级定义——组件体内定义会在每次渲染重挂载子树 */
function ActionRow({ a, onMenu }: { a: TodayAction; onMenu: (a: TodayAction, el: HTMLElement) => void }) {
  const tag = dueTag(a.due_at) ?? dueTag(a.parent_due);
  return (
    <div className="min-w-0 flex-1">
      <p className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm text-ink">{a.title}</span>
        {!a.parent_title && (
          <span className="shrink-0 rounded-lg bg-slate-500/15 px-1.5 py-0.5 text-badge font-medium text-ink-dim" title="独立行动（不属于任何 todo）">
            行动
          </span>
        )}
        {a.repeat_daily && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-lg bg-emerald-500/20 px-1.5 py-0.5 text-badge font-medium text-success" title="每日重复">
            <Repeat size={11} aria-hidden /> {a.repeat_done_count > 0 ? `×${a.repeat_done_count}` : ""}
          </span>
        )}
        {a.note && (
          <span className="shrink-0 text-ink-faint" title="有描述">
            <FileText size={11} aria-hidden />
          </span>
        )}
        <button
          onClick={(e) => onMenu(a, e.currentTarget)}
          aria-label="操作菜单"
          className="tap-lg press ml-auto shrink-0 rounded p-1 text-ink-faint transition hover:bg-wash hover:text-ink"
        >
          <Ellipsis size={14} />
        </button>
      </p>
      {(a.parent_title || tag) && (
        <p className="mt-0.5 flex items-center gap-1.5 text-micro text-ink-faint">
          {a.parent_title && <span className="min-w-0 truncate">来自「{a.parent_title}」</span>}
          {tag && <span className={`shrink-0 ${tag.cls}`}>{tag.text}</span>}
        </p>
      )}
    </div>
  );
}

export default function ActionsToday({ notify }: { notify: (e: { ok: boolean; text: string } | null) => void }) {
  const [actions, setActions] = useState<TodayAction[] | null>(null);
  // 打卡进行中的行动 id：接到对应行按钮 disabled，防连点重复打卡
  const [busyId, setBusyId] = useState<string | null>(null);
  // N6 添加行动
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  // N6/N3 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  // 行内编辑保存进行中：防双击重复保存
  const [editSaving, setEditSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const j = await api("/api/todos?view=today-actions");
      setActions(j.actions ?? []);
    } catch (e) {
      setActions([]);
      notify({ ok: false, text: `行动清单加载失败：${e instanceof Error ? e.message : e}` });
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // 发布动态后 AI 识别数秒落库：订阅识别完成事件自动重拉（否则识别出的 todo 要手动刷新页面才出现）
  useEffect(() => {
    const onAnalyzed = () => void load();
    window.addEventListener("shiguang:entry-analyzed", onAnalyzed);
    return () => window.removeEventListener("shiguang:entry-analyzed", onAnalyzed);
  }, [load]);

  /** N6：直接添加独立行动（默认标记今日，当日出现在清单） */
  async function addAction() {
    const t = newTitle.trim();
    if (!t || adding) return;
    setAdding(true);
    try {
      await api("/api/todos", "POST", { title: t, kind: "action", today: true });
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
    if (busyId) return; // 打卡进行中忽略再次点击
    const done = a.status === "done";
    setBusyId(a.id);
    try {
      await api(`/api/todos/${a.id}`, "PATCH", done ? { undone: true } : { done: true });
      if (a.repeat_daily && !done) {
        notify({ ok: true, text: `🎉 完成「${a.title}」，已坚持 ×${a.repeat_done_count + 1}` });
      }
      await load();
    } catch (e) {
      // 断网等失败不外抛：裸 rejection 会被 ChunkErrorReloader 宽匹配整页刷新
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  /** N6：删除行动（独立/有父皆可；调用方已过两步确认） */
  async function removeAction(a: TodayAction) {
    try {
      await api(`/api/todos/${a.id}`, "DELETE");
      notify({ ok: true, text: "🗑 行动已删除" });
      await load();
    } catch (e) {
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  /* ---- 行操作菜单（REQ-009 滚动：与 todo-board/空间详情同一菜单） ---- */
  const [menu, setMenu] = useState<{ info: { todo: TodayAction; isChild: boolean; parentTitle: string | null }; pos: { top: number; left: number } } | null>(null);
  const [decomposingId, setDecomposingId] = useState<string | null>(null);

  function openMenu(a: TodayAction, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    setMenu({
      info: { todo: a, isChild: a.kind === "action" || !!a.parent_todo_id, parentTitle: a.parent_title },
      pos: { top: Math.min(rect.bottom + 6, window.innerHeight - 280), left: Math.max(8, rect.right - 228) },
    });
  }

  /** 菜单项 patch（每日重复/重要/今日/恢复） */
  async function patchTodo(id: string, body: Record<string, unknown>, okText?: string): Promise<boolean> {
    try {
      await api(`/api/todos/${id}`, "PATCH", body);
      if (okText) notify({ ok: true, text: okText });
      await load();
      return true;
    } catch (e) {
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /** AI 拆解/细化（父在清单内会带出行动；仅行动可见清单变化） */
  async function decompose(a: { id: string; title: string }, _isAction: boolean) {
    if (decomposingId) return;
    setDecomposingId(a.id);
    try {
      const j = await api<{ actions?: unknown[] }>(`/api/todos/${a.id}/decompose`, "POST", {});
      notify({ ok: true, text: `✨ AI 拆出 ${j.actions?.length ?? 0} 个行动` });
      await load();
    } catch (e) {
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDecomposingId(null);
    }
  }

  /** 菜单删除：确认弹窗 → DELETE（行内两步确认保留） */
  async function menuRemove(a: { id: string; title: string }, isChild: boolean) {
    const ok = await confirmDialog({
      title: isChild ? "删除行动" : "删除 todo",
      message: isChild ? `「${a.title}」` : `「${a.title}」
其下行动将一并删除。`,
      confirmText: "删除",
    });
    if (!ok) return;
    await removeAction(a as TodayAction);
  }

  /** N6/N3：行内编辑（标题+截止），Enter 保存、点空白/Esc 取消 */
  function startEdit(a: TodayAction) {
    setEditingId(a.id);
    setEditTitle(a.title);
    // 与 Dismissable onClose 的脏检查同口径（isoToLocalInput），避免跨时区恒判"有改动"
    setEditDue(isoToLocalInput(a.due_at));
    setTimeout(() => editInputRef.current?.focus(), 60);
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim() || editSaving) return; // 保存进行中忽略再次提交，防双击重复保存
    setEditSaving(true);
    try {
      await api(`/api/todos/${editingId}`, "PATCH", {
        title: editTitle.trim(),
        // editDue 是北京墙上时间串（isoToLocalInput 产），必须按 +08:00 解析——
        // 裸 new Date() 按宿主时区解释，海外设备会存错 N 小时
        dueAt: editDue ? localInputToIso(editDue) : null,
      });
      setEditingId(null);
      await load();
    } catch (e) {
      notify({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setEditSaving(false);
    }
  }

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  const done = (actions ?? []).filter((a) => a.status === "done");


  return (
    <section className="glass mb-5 rounded-2xl p-5" id="actions">
      {menu && (
        <TodoRowMenu
          info={menu.info}
          menuPos={menu.pos}
          onClose={() => setMenu(null)}
          actions={{
            decomposingId,
            patch: patchTodo,
            decompose,
            remove: menuRemove,
            pendingCount: () => 0,
            startEdit: (t) => startEdit(t as TodayAction),
          }}
        />
      )}
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
        <a href="/schedule?tab=todo" className="flex shrink-0 items-center gap-0.5 rounded-lg px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-sky-500/10">
          规划 <ArrowRight size={12} aria-hidden />
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
              placeholder="添加行动，回车保存"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
            />
            {newTitle.trim() && (
              <button
                onClick={() => void addAction()}
                disabled={adding}
                className="btn-primary shrink-0 rounded-lg px-3 py-1 text-micro font-medium disabled:opacity-50"
              >
                {adding ? "保存中…" : "添加"}
              </button>
            )}
          </div>

          {pending.length === 0 && done.length === 0 ? (
            <div className="py-2 text-center">
              <p className="text-xs text-ink-dim">今天还没有行动 —— 在上面直接添加一条（自动标记今日 ☀️），或在 todo 里 ✨ 拆解出可执行的行动</p>
            </div>
          ) : (
            <>
              <ul className="space-y-0.5">
                {pending.map((a) => {
                  // 到期提示：行动自身优先，父待办兜底（独立行动只有自身 due）
                  const isEditing = editingId === a.id;
                  return (
                    <li key={a.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-elevated/60">
                      {isEditing ? (
                        /* N3/N6 行内编辑：标题 + 截止；点空白/Esc 取消 */
                        <Dismissable
                          onClose={() => {
                            // 与 startEdit 同口径（本地 datetime-local 串）：原来用 UTC 切片比较，UTC+8 下恒不相等
                            const dirty = editTitle !== a.title || editDue !== isoToLocalInput(a.due_at);
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
                              className="rounded border border-line-strong bg-surface px-2 py-1 text-micro tabular-nums outline-none focus:border-sky-500"
                            />
                            <div className="ml-auto flex gap-2">
                              <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-micro text-ink-mute hover:bg-soft">取消</button>
                              <button onClick={() => void saveEdit()} disabled={!editTitle.trim() || editSaving} className="rounded bg-sky-600 px-2.5 py-1 text-micro font-medium text-white hover:bg-sky-500 disabled:opacity-50">保存</button>
                            </div>
                          </div>
                        </Dismissable>
                      ) : (
                        <>
                          <TodoCircle size="md" done={false} disabled={busyId === a.id} onClick={() => toggleDone(a)} />
                          <ActionRow a={a} onMenu={openMenu} />
                          {/* 编辑/删除收进 ⋯ 菜单（REQ-009 滚动：行面只留打卡与菜单入口） */}
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
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-white"><Check size={11} strokeWidth={3} /></span>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-dim line-through">{a.title}</span>
                        {a.repeat_daily && a.repeat_done_count > 0 && (
                          <span className="shrink-0 text-badge text-success">×{a.repeat_done_count}</span>
                        )}
                        <button
                          onClick={() => toggleDone(a)}
                          disabled={busyId === a.id}
                          title="恢复为未完成"
                          className="row-actions hidden shrink-0 rounded px-1.5 py-0.5 text-ink-mute hover:bg-soft hover:text-warn group-hover:block disabled:opacity-50"
                        >
                          <RotateCcw size={12} />
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
