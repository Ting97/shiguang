"use client";

import { useState } from "react";
import type { Activity, FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import { RowAction } from "./row-action";
import { RowActionMenu, useRowMenu } from "./row-action-menu";
import { useHoverCapable } from "./use-hover-capable";
import { combineHM, combineHmEndCrossDay } from "@/lib/bj-time"; // 北京口径版：本地 setHours 在海外设备会偏 8 小时（与日程页同源）
import { dayPrefix, zhClock } from "./kit";
import type { DelFn, RunFn } from "./types";

/** 日程块行内编辑态 */
interface EditBlockState {
  id: string;
  title: string;
  start: string;
  end: string;
  activityId: string;
}

interface BlockRowsProps {
  m: FeedMoment;
  activities: Activity[];
  run: RunFn;
  del: DelFn;
  /** 当前处于待确认态的删除 key */
  delArmed: string | null;
}

/** ---- 日程块 ----：展示 + 行内编辑/删除 */
export function BlockRows({ m, activities, run, del, delArmed }: BlockRowsProps) {
  const hoverOk = useHoverCapable();
  const { menu, open, close } = useRowMenu();
  const [editBlock, setEditBlock] = useState<EditBlockState | null>(null);

  return (
    <>
      {m.blocks.map((b) =>
        editBlock?.id === b.id ? (
          <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
            <input
              value={editBlock.title}
              onChange={(e) => setEditBlock({ ...editBlock, title: e.target.value })}
              className="min-w-28 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
              placeholder="标题"
            />
            <input
              type="time"
              value={editBlock.start}
              onChange={(e) => setEditBlock({ ...editBlock, start: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
            />
            <span className="text-ink-dim" title="结束早于开始自动按次日（跨日程）">至</span>
            {editBlock.end <= editBlock.start && (
              <span className="rounded bg-sky-500/15 px-1 text-badge text-accent" title="结束早于开始，保存后自动 +1 天">次日 +1</span>
            )}
            <input
              type="time"
              value={editBlock.end}
              onChange={(e) => setEditBlock({ ...editBlock, end: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
            />
            <select
              value={editBlock.activityId}
              onChange={(e) => setEditBlock({ ...editBlock, activityId: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
            <span className="flex gap-1">
              <button onClick={() => setEditBlock(null)} className="rounded px-2 py-1 text-micro text-ink-mute hover:bg-soft">取消</button>
              <button
                onClick={() =>
                  run(async () => {
                    const startAt = combineHM(b.startAt, editBlock.start);
                    await api(`/api/blocks/${b.id}`, "PATCH", {
                      title: editBlock.title.trim() || b.title,
                      startAt,
                      endAt: combineHmEndCrossDay(startAt, editBlock.end, b.endAt),
                      activityId: editBlock.activityId,
                    });
                    setEditBlock(null);
                    return "💾 日程已更新";
                  })
                }
                className="rounded bg-sky-600 px-2 py-1 text-micro font-medium hover:bg-sky-500"
              >
                保存
              </button>
            </span>
          </div>
        ) : (
          <p
            key={b.id}
            className="group/row flex items-center gap-x-2 gap-y-0.5"
            onClick={(e) => {
              if (hoverOk) return;
              open(`block:${b.id}`, {
                x: e.clientX,
                y: e.clientY,
                onEdit: () =>
                  setEditBlock({
                    id: b.id,
                    title: b.title,
                    start: zhClock(b.startAt),
                    end: zhClock(b.endAt),
                    activityId: activities.some((a) => a.id === b.activityId) ? b.activityId : activities[0]?.id ?? "",
                  }),
                onDelete: () => del(`block:${b.id}`, () => api(`/api/blocks/${b.id}`, "DELETE")),
              });
            }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
            <span className="truncate">
              {b.icon} {b.activityName} · {b.title}
            </span>
            <span className="shrink-0 tabular-nums text-ink-mute">
              {dayPrefix(b.startAt)}{zhClock(b.startAt)}–{zhClock(b.endAt)} · {b.durationMin} 分钟
            </span>
            <RowAction
              onEdit={() =>
                setEditBlock({
                  id: b.id,
                  title: b.title,
                  start: zhClock(b.startAt),
                  end: zhClock(b.endAt),
                  activityId: activities.some((a) => a.id === b.activityId) ? b.activityId : activities[0]?.id ?? "",
                })
              }
              armed={delArmed === `block:${b.id}`}
              onDelete={() =>
                del(`block:${b.id}`, () =>
                  api(`/api/blocks/${b.id}`, "DELETE"))
              }
            />
          </p>
        ),
      )}
      <RowActionMenu menu={menu} onClose={close} />
    </>
  );
}
