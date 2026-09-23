"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Activity, Space } from "@/lib/types";
import type { Draft, View } from "./types";

/**
 * 添加任务行（拆分自 todo-board，行为零变化；已完成视图不显示）。
 * N3：展开后点空白收起（收起判定在入口 addRowRef），有未提交标题则轻提示。
 */
export function AddTodoRow({
  addRowRef,
  draft,
  setDraft,
  draftOpen,
  setDraftOpen,
  view,
  activities,
  spaces,
  adding,
  onAdd,
}: {
  addRowRef: { current: HTMLDivElement | null };
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  draftOpen: boolean;
  setDraftOpen: (open: boolean) => void;
  view: View;
  activities: Activity[];
  spaces: Space[];
  adding: boolean;
  onAdd: () => void;
}) {
  return (
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
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onAdd();
          }}
          placeholder="添加 todo，回车保存"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={onAdd}
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
  );
}
