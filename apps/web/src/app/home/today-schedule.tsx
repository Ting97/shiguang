"use client";

import { useEffect, useRef, useState } from "react";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import BlockDraftForm, { type BlockDraftValue } from "@/components/block-draft-form";
import { TagChip, FilterChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { parseYmd, todayStr, zhDuration } from "@/lib/date";
import type { Activity, Block } from "@/lib/types";
import { zhTime } from "./kit";
import type { BlockDraft, Notify } from "./types";

interface Props {
  blocks: Block[];
  activities: Activity[];
  todayKcal: number;
  setMsg: Notify;
  load: () => Promise<void>;
}

/** 今日日程：时间轴 / 列表 双视图（行内编辑、删除、缺口补录逻辑自 page.tsx 原样迁出） */
export default function TodaySchedule({ blocks, activities, todayKcal, setMsg, load }: Props) {
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [listDraft, setListDraft] = useState<BlockDraftValue | null>(null);
  const [listSaving, setListSaving] = useState(false);
  const listFormRef = useRef<HTMLDivElement>(null);

  function startEdit(b: Block) {
    setEditing({
      id: b.id,
      title: b.title,
      start: zhTime(b.start_at),
      end: zhTime(b.end_at),
      activityId: b.activity_id,
    });
  }

  /** 用原块北京日期 + 新的 HH:MM 组装 ISO（北京时间口径：+8h 推算 setUTC 后再回移 8h） */
  function combineHM(originalIso: string, hm: string): string {
    const d = new Date(new Date(originalIso).getTime() + 8 * 3600_000);
    const [h, m] = hm.split(":").map(Number);
    d.setUTCHours(h, m, 0, 0);
    return new Date(d.getTime() - 8 * 3600_000).toISOString();
  }

  async function saveEdit() {
    if (!editing) return;
    if (editing.end <= editing.start) {
      setMsg({ ok: false, text: "结束时间必须晚于开始时间" });
      return;
    }
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    try {
      await api(`/api/blocks/${editing.id}`, "PATCH", {
        title: editing.title.trim() || b.title,
        startAt: combineHM(b.start_at, editing.start),
        endAt: combineHM(b.end_at, editing.end),
        activityId: editing.activityId,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
      return;
    }
    setEditing(null);
    setMsg({ ok: true, text: "💾 日程已更新" });
    await load();
  }

  async function removeBlock(b: Block) {
    if (!window.confirm(`删除这条日程？\n「${b.title}」 ${zhTime(b.start_at)}–${zhTime(b.end_at)}`)) return;
    try {
      await api(`/api/blocks/${b.id}`, "DELETE");
    } catch {
      setMsg({ ok: false, text: "删除失败" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除「${b.title}」` });
    await load();
  }

  /** 时间轴缺口补录 */
  async function createBlock(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    try {
      await api("/api/blocks", "POST", payload);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "补录失败" });
      return false;
    }
    setMsg({ ok: true, text: `✍️ 已补录：${payload.title}` });
    await load();
    return true;
  }

  const todayByActivity = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.activity_id] = (acc[b.activity_id] ?? 0) + b.duration_min;
    return acc;
  }, {});

  /** 时间轴上点击时间块 → 切到列表视图并打开编辑器 */
  function editBlockFromTimeline(b: Block) {
    setView("list");
    startEdit(b);
  }

  // ---------- 列表视图新增日程 ----------

  const hmLocal = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const minOfDayLocal = (iso: string) => {
    const day = parseYmd(todayStr());
    return Math.max(0, Math.min(1440, Math.floor((new Date(iso).getTime() - day.getTime()) / 60_000)));
  };

  /** 从当前小时起找第一个空闲的整点 1 小时槽位（都占用则用当前小时，由冲突提示兜底）。
   *  「当前」取北京小时（UTC+8 推算），与 zhTime 展示及日程块同口径；从现在之后开始找，不含已过时段 */
  function nextFreeSlot(): BlockDraftValue {
    const curH = new Date(Date.now() + 8 * 3600_000).getUTCHours();
    const spans = blocks.map((b) => [minOfDayLocal(b.start_at), minOfDayLocal(b.end_at)]);
    for (let h = curH; h < 24; h++) {
      if (!spans.some(([s, e]) => h * 60 < e && (h + 1) * 60 > s)) {
        return { title: "", start: hmLocal(h * 60), end: hmLocal((h + 1) * 60), activityId: "other" };
      }
    }
    return { title: "", start: hmLocal(curH * 60), end: hmLocal(Math.min(24, curH + 1) * 60), activityId: "other" };
  }

  useEffect(() => {
    if (listDraft) listFormRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [listDraft]);

  async function submitListDraft() {
    if (!listDraft || !listDraft.title.trim() || listSaving) return;
    setListSaving(true);
    const [sh, sm] = listDraft.start.split(":").map(Number);
    const [eh, em] = listDraft.end.split(":").map(Number);
    const day = parseYmd(todayStr());
    const ok = await createBlock({
      title: listDraft.title.trim(),
      startAt: new Date(day.getTime() + (sh * 60 + sm) * 60_000).toISOString(),
      endAt: new Date(day.getTime() + (eh * 60 + em) * 60_000).toISOString(),
      activityId: listDraft.activityId,
    });
    setListSaving(false);
    if (ok) setListDraft(null);
  }

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <span className="inline-flex items-center gap-1">
            🕐 今日日程{" "}
            <span className="whitespace-nowrap text-xs font-normal text-ink-dim">
              {blocks.length} 段 · 共 {zhDuration(blocks.reduce((s, b) => s + b.duration_min, 0))}
            </span>
          </span>
          {todayKcal > 0 && <TagChip icon="🍽" label={`今日 ≈${todayKcal} kcal`} tone="amber" size="sm" className="whitespace-nowrap" />}
        </h2>
        <div className="flex shrink-0 rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs">
          <FilterChip variant="pill" active={view === "timeline"} onClick={() => setView("timeline")} label="时间轴" />
          <FilterChip variant="pill" active={view === "list"} onClick={() => setView("list")} label="列表" />
        </div>
      </div>

      {view === "timeline" ? (
        <div>
          <div className="mb-3 rounded-lg border border-line-soft bg-bg/40 p-3">
            <DayDonut byActivity={todayByActivity} activities={activities} size={90} thickness={12} />
          </div>
          <DayTimeline
            date={todayStr()}
            blocks={blocks}
            activities={activities}
            onCreate={createBlock}
            onEditBlock={editBlockFromTimeline}
          />
        </div>
      ) : (
        <>
          <div ref={listFormRef}>
            {listDraft && (
              <BlockDraftForm
                value={listDraft}
                activities={activities}
                busy={listSaving}
                onChange={setListDraft}
                onCancel={() => setListDraft(null)}
                onSubmit={submitListDraft}
              />
            )}
          </div>
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setListDraft(nextFreeSlot())}
              className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-accent transition hover:border-sky-500/50"
            >
              ＋ 新增日程
            </button>
          </div>
          {blocks.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-faint">
              还没有记录 —— 说句"刚做完…"，点「＋ 新增日程」，或去完成一个 todo
            </p>
          )}
          <ul className="space-y-1.5">
            {blocks.map((b) =>
              editing?.id === b.id ? (
                /* ---- 行内编辑器 ---- */
                <li key={b.id} className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
                      placeholder="标题"
                    />
                    <input
                      type="time"
                      value={editing.start}
                      onChange={(e) => setEditing({ ...editing, start: e.target.value })}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <span className="text-xs text-ink-dim">至</span>
                    <input
                      type="time"
                      value={editing.end}
                      onChange={(e) => setEditing({ ...editing, end: e.target.value })}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <select
                      value={editing.activityId}
                      onChange={(e) => setEditing({ ...editing, activityId: e.target.value })}
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
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft"
                    >
                      取消
                    </button>
                    <button
                      onClick={saveEdit}
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </div>
                </li>
              ) : (
                /* ---- 常规行 ---- */
                <li key={b.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-elevated/60">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="shrink-0 text-xs tabular-nums text-ink-mute">
                    {zhTime(b.start_at)}–{zhTime(b.end_at)}
                  </span>
                  <span className="text-base">{b.icon}</span>
                  <span className="flex-1 truncate text-sm">{b.title}</span>
                  <span className="shrink-0 text-xs text-ink-dim">{b.duration_min} 分钟</span>
                  <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={() => startEdit(b)}
                      title="修改"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeBlock(b)}
                      title="删除"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger"
                    >
                      🗑
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </section>
  );
}
