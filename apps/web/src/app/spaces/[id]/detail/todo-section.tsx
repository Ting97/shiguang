"use client";

import type { Dispatch, SetStateAction } from "react";
import { TagChip } from "@/components/tag-chip";
import { childProgress } from "@/components/todo-bits";
import type { Activity, TodoItem } from "@/lib/types";
import { bjDate } from "./kit";
import TodoRowItem from "./todo-row";
import type { Msg } from "./types";
import type { TodoActions } from "./use-todo-actions";

/** 关联 TODO·行动区块（自 detail.tsx 拆出）：添加 todo / 行列表 / 已完成折叠列表 */
export default function TodoSection(opts: {
  todos: TodoItem[];
  doneTodos: TodoItem[];
  actions: TodoActions;
  activities: Activity[];
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { todos, doneTodos, actions, activities, setMsg } = opts;
  const { newTodo, setNewTodo, addTodo, expanded, setExpanded, patchTodo, openLinkPicker } = actions;
  return (
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
          {todos.map((t) => (
            <TodoRowItem key={t.id} t={t} expanded={expanded} setExpanded={setExpanded} actions={actions} activities={activities} setMsg={setMsg} />
          ))}
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
  );
}
