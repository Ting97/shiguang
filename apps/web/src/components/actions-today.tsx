"use client";

import { useCallback, useEffect, useState } from "react";
import TodoLogo from "./todo-logo";
import { TodoCircle, dueTag } from "./todo-bits";
import type { TodayAction } from "@/lib/types";

/**
 * 首页「今日行动清单」（REQ-001 R3）：
 * - 只展示行动级条目：① 🔁 每日重复的行动（每天出现）；② 父待办标记今日或今日到期的行动
 * - 行动行带父待办名上下文（点击跳 /schedule）与已完成次数 ×N
 * - 数据自取 /api/todos?view=today-actions（06:00 记录日惰性日切在服务端读取时触发）
 */
export default function ActionsToday({ notify }: { notify: (e: { ok: boolean; text: string } | null) => void }) {
  const [actions, setActions] = useState<TodayAction[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  const done = (actions ?? []).filter((a) => a.status === "done");

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
      ) : actions.length === 0 ? (
        <div className="py-2 text-center">
          <p className="text-xs text-ink-dim">今天还没有行动 —— 把 todo 标为今日（☀️），或在 todo 里 ✨ 拆解出可执行的行动</p>
          <a href="/schedule?tab=todo" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
            去「日程 · TODO」规划 →
          </a>
        </div>
      ) : (
        <>
          <ul className="space-y-0.5">
            {pending.map((a) => {
              // 到期提示：行动自身优先，父待办兜底（顶层待办条目只有自身 due）
              const tag = dueTag(a.due_at) ?? dueTag(a.parent_due);
              return (
                <li key={a.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-elevated/60">
                  <TodoCircle size="md" done={false} onClick={() => toggleDone(a)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm text-ink">{a.title}</span>
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
    </section>
  );
}
