"use client";

import type { Activity, FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import { TagChip } from "../tag-chip";
import { RowAction } from "./row-action";
import { BlockRows } from "./recognition-blocks";
import { TodoRows } from "./recognition-todos";
import { TxRows } from "./recognition-transactions";
import type { DelFn, RunFn } from "./types";

interface RecognitionSectionProps {
  m: FeedMoment;
  activities: Activity[];
  run: RunFn;
  del: DelFn;
  /** 当前处于待确认态的删除 key（按钮呈「确认删除?」） */
  delArmed: string | null;
}

/** AI 识别产物容器：日程 / todo / 金额 / 人物 / 饮食（均可修改/删除），无任何产物时不渲染 */
export function RecognitionSection({ m, activities, run, del, delArmed }: RecognitionSectionProps) {
  if (!(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0 || m.people.length > 0 || m.diet)) {
    return null;
  }

  return (
    <div className="mt-2.5 space-y-1 rounded-lg border border-line-soft bg-bg/50 px-3 py-2 text-xs text-ink-soft">
      {/* ---- 日程块 ---- */}
      <BlockRows m={m} activities={activities} run={run} del={del} delArmed={delArmed} />

      {/* ---- todo ---- */}
      <TodoRows m={m} activities={activities} run={run} del={del} delArmed={delArmed} />

      {/* ---- 金额流水 ---- */}
      <TxRows m={m} run={run} del={del} delArmed={delArmed} />

      {/* ---- 人物 ---- */}
      {m.people.length > 0 && (
        <p className="group/row flex items-center gap-x-2 text-ink-mute">
          <TagChip icon="👥" label={m.people.map((p) => p.name).join("、")} tone="sky" size="sm" />
          <RowAction
            armed={delArmed === `people:${m.id}`}
            onDelete={() =>
              del(`people:${m.id}`, () =>
                Promise.all(m.people.map((p) => api(`/api/interactions/${p.interactionId}`, "DELETE"))).then(() => undefined))
            }
          />
        </p>
      )}

      {/* ---- 饮食 ---- */}
      {m.diet && (
        <p className="group/row flex items-center gap-x-2 text-ink-mute">
          <TagChip icon="🍽" label="饮食" tone="amber" size="sm" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {m.diet.meal !== "未知" ? `${m.diet.meal} · ` : ""}
            {(m.diet.items ?? []).map((i) => `${i.name}${i.amount ?? ""}`).join(" + ")}
            {m.diet.totalKcal != null ? ` · ≈${m.diet.totalKcal} kcal` : ""}
          </span>
          <button
            onClick={() =>
              del(`diet:${m.id}`, async () => {
                await api(`/api/entries/${m.id}/diet`, "DELETE");
                return "🗑 已删除饮食记录";
              })
            }
            title={delArmed === `diet:${m.id}` ? "3 秒内再点确认删除" : "删除饮食记录"}
            className={`row-actions-hidden hidden shrink-0 rounded px-1 text-xs group-hover/row:block ${delArmed === `diet:${m.id}` ? "bg-rose-500/15 font-medium text-danger" : "text-ink-dim hover:text-danger"}`}
          >
            {delArmed === `diet:${m.id}` ? "确认删除?" : "🗑"}
          </button>
        </p>
      )}
    </div>
  );
}
