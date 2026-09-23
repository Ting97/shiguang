"use client";

import { useEffect, useRef, useState } from "react";
import type { Activity } from "@/lib/types";

export interface BlockDraft {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}

interface Props {
  draft: BlockDraft;
  activities: Activity[];
  onChange: (d: BlockDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
}

/** 时间块编辑面板（工作台列表 / 日历日视图共用） */
export default function BlockEditor({ draft, activities, onChange, onSave, onCancel, onDelete, saving }: Props) {
  // 删除两步确认：首次点按只进入待确认态（3 秒内再点才真删），与站内样式化确认一致、免原生弹窗
  const [armDelete, setArmDelete] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  function onDeleteClick() {
    if (!onDelete) return;
    if (armDelete) {
      if (armTimer.current) clearTimeout(armTimer.current);
      onDelete();
      return;
    }
    setArmDelete(true);
    armTimer.current = setTimeout(() => setArmDelete(false), 3000);
  }

  return (
    <div className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSave()}
          className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
          placeholder="标题"
        />
        <input
          type="time"
          value={draft.start}
          onChange={(e) => onChange({ ...draft, start: e.target.value })}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <span className="text-xs text-ink-dim">至</span>
        <input
          type="time"
          value={draft.end}
          onChange={(e) => onChange({ ...draft, end: e.target.value })}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <select
          value={draft.activityId}
          onChange={(e) => onChange({ ...draft, activityId: e.target.value })}
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
        {onDelete && (
          <button
            onClick={onDeleteClick}
            className={`rounded px-3 py-1 text-xs transition ${armDelete ? "bg-danger font-medium text-white hover:bg-danger/80" : "text-danger hover:bg-soft"}`}
          >
            {armDelete ? "确认删除？" : "删除"}
          </button>
        )}
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft">
          取消
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
