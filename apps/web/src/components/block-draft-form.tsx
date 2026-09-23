"use client";

import type { Activity } from "@/lib/types";

export interface BlockDraftValue {
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}

/** 补录/新增日程的行内表单（时间轴缺口点击与列表新增共用） */
export default function BlockDraftForm({
  value,
  activities,
  busy = false,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: BlockDraftValue;
  activities: Activity[];
  busy?: boolean;
  onChange: (v: BlockDraftValue) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-warn">
          补录 <span className="tabular-nums">{value.start}–{value.end}</span>
        </span>
        <input
          autoFocus
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSubmit()}
          placeholder="这段时间在做什么？"
          className="min-w-28 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-amber-400"
        />
        <input
          type="time"
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none"
        />
        <span className="text-xs text-ink-dim">至</span>
        <input
          type="time"
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none"
        />
        <select
          value={value.activityId}
          onChange={(e) => onChange({ ...value, activityId: e.target.value })}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none"
        >
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft">
          取消
        </button>
        <button
          onClick={onSubmit}
          disabled={busy || !value.title.trim()}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-medium hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "保存中…" : "补录"}
        </button>
      </div>
    </div>
  );
}
