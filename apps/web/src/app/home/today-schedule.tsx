"use client";

import { useEffect, useRef, useState } from "react";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import BlockDraftForm, { type BlockDraftValue } from "@/components/block-draft-form";
import { Clock, Pencil, Plus, Trash2, Utensils } from "lucide-react";
import { TagChip, FilterChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { bjToday, zhDuration } from "@/lib/date";
import { combineHM, combineHmEndCrossDay, bjDateKey } from "@/lib/bj-time";
import type { Activity, Block } from "@/lib/types";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import { zhTime } from "./kit";
import type { BlockDraft } from "./types";

interface Props {
  blocks: Block[];
  activities: Activity[];
  todayKcal: number;
  load: () => Promise<void>;
}

/** 今日日程：时间轴 / 列表 双视图（行内编辑、删除、缺口补录逻辑自 page.tsx 原样迁出） */
export default function TodaySchedule({ blocks, activities, todayKcal, load }: Props) {
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [listDraft, setListDraft] = useState<BlockDraftValue | null>(null);
  const [listSaving, setListSaving] = useState(false);
  // 删除两步确认（全站规范，替代原生 confirm）
  const armDelete = useArmConfirm();
  // 行内编辑保存进行中：防双击重复提交（文案/禁用同 listSaving 口径）
  const [saving, setSaving] = useState(false);
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

  /** 用原块北京日期 + 新的 HH:MM 组装 ISO（combineHM 收敛到 @/lib/bj-time，与日程页同源） */
  async function saveEdit() {
    if (!editing || saving) return; // 保存进行中忽略再次提交，防双击重复保存
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    // HH:MM 完整性守卫（与 submitListDraft 同款）：清空 time 输入后 split 出 NaN——
    // 旧版清空「结束」误报「结束时间必须晚于开始时间」，清空「开始」反而通过且 combineHM
    // 守卫回退原值（保存成功 toast 但开始时间原样未变，所见与所存不一致）
    const [sh, sm] = editing.start.split(":").map(Number);
    const [eh, em] = editing.end.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => !Number.isFinite(n)) || sh > 23 || eh > 23 || sm > 59 || em > 59) {
      toast("请填写完整的开始与结束时间", "err");
      return;
    }
    // 跨天块（23:00→次日 00:30）end 钟点 ≤ start 是合法次日语义，不走同日校验；
    // 结束写回用跨日组合（与 calendar-panel 同范式）——旧逻辑对跨天块恒报
    // 「结束时间必须晚于开始时间」，改任何字段都保存不了。
    // 十七轮：同日块编辑出 end ≤ start 同样按次日语义放行（与动态流行内编辑同口径），
    // toast 说明跨天防误解——旧逻辑手动路径无法把块改成跨天
    const storedCrossDay = bjDateKey(b.start_at) !== bjDateKey(b.end_at);
    const crossDay = storedCrossDay || editing.end <= editing.start;
    setSaving(true);
    try {
      const startAt = combineHM(b.start_at, editing.start);
      await api(`/api/blocks/${editing.id}`, "PATCH", {
        title: editing.title.trim() || b.title,
        startAt,
        endAt: crossDay ? combineHmEndCrossDay(startAt, editing.end, b.end_at) : combineHM(b.end_at, editing.end),
        activityId: editing.activityId,
      });
      if (!storedCrossDay && crossDay) toast(`已按跨天块保存：${editing.start} → 次日 ${editing.end}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "err");
      return;
    } finally {
      setSaving(false);
    }
    setEditing(null);
    if (!(!storedCrossDay && crossDay)) toast("💾 日程已更新");
    await load();
  }

  async function removeBlock(b: Block) {
    if (!armDelete.arm(b.id)) return;
    try {
      await api(`/api/blocks/${b.id}`, "DELETE");
    } catch {
      toast("删除失败", "err");
      return;
    }
    toast(`🗑 已删除「${b.title}」`);
    await load();
  }

  /** 时间轴缺口补录 */
  async function createBlock(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    try {
      await api("/api/blocks", "POST", payload);
    } catch (e) {
      toast(e instanceof Error ? e.message : "补录失败", "err");
      return false;
    }
    toast(`✍️ 已补录：${payload.title}`);
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
  /** ISO 时刻 → 北京当日分钟数（0~1440；基点是北京日界而非本地午夜，与 zhTime/combineHM 同口径） */
  const minOfDayLocal = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
    return Math.max(0, Math.min(1440, d.getUTCHours() * 60 + d.getUTCMinutes()));
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
    // 23 点兜底槽：end 钳 23:59（<input type="time"> 无法表示 24:00，会显示为空并触发必填校验）
    return { title: "", start: hmLocal(curH * 60), end: hmLocal(Math.min(23 * 60 + 59, (curH + 1) * 60)), activityId: "other" };
  }

  useEffect(() => {
    if (listDraft) listFormRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [listDraft]);

  async function submitListDraft() {
    if (!listDraft || !listDraft.title.trim() || listSaving) return;
    const [sh, sm] = listDraft.start.split(":").map(Number);
    const [eh, em] = listDraft.end.split(":").map(Number);
    // HH:MM 形状守卫：清空 time 输入后 split 出 NaN，Date 构造抛 Invalid time value 且
    // setListSaving(false) 永不执行 → 按钮永久卡「保存中…」（只能刷新页面）
    const badTime = [sh, sm, eh, em].some((n) => !Number.isFinite(n)) || sh > 23 || eh > 23 || sm > 59 || em > 59;
    if (badTime) {
      toast("请填写完整的开始与结束时间", "err");
      return;
    }
    setListSaving(true);
    try {
      // 北京今天 0 点作基：必须显式 +08:00（T00:00:00Z 是 UTC 零点=北京 08:00，
      // 旧版所有补录块整体晚 8 小时；本地午夜基在海外设备又会错 8 小时）
      const dayMs = Date.parse(`${bjToday()}T00:00:00+08:00`);
      // 跨天回绕（同页时间轴视图 day-timeline submitCreate 同口径）：23:00→06:00 的
      // end<=start 曾原样提交被服务端 400 拒掉，而时间轴视图同输入能成功
      const crossesDay = eh * 60 + em <= sh * 60 + sm;
      const ok = await createBlock({
        title: listDraft.title.trim(),
        startAt: new Date(dayMs + (sh * 60 + sm) * 60_000).toISOString(),
        endAt: new Date(dayMs + (eh * 60 + em + (crossesDay ? 1440 : 0)) * 60_000).toISOString(),
        activityId: listDraft.activityId,
      });
      if (ok) setListDraft(null);
    } finally {
      setListSaving(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <Clock size={14} className="text-accent" aria-hidden /> 今日日程{" "}
            <span className="whitespace-nowrap text-xs font-normal text-ink-dim">
              {blocks.length} 段 · 共 {zhDuration(blocks.reduce((s, b) => s + b.duration_min, 0))}
            </span>
          </span>
          {todayKcal > 0 && <TagChip icon={<Utensils size={12} />} label={`今日 ≈${todayKcal} kcal`} tone="amber" size="sm" className="whitespace-nowrap" />}
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
            date={bjToday()}
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
              className="flex items-center gap-1 rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-accent transition hover:border-sky-500/50"
            >
              <Plus size={12} aria-hidden /> 新增日程
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
                      disabled={saving}
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-40"
                    >
                      {saving ? "保存中…" : "保存"}
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
                      className="rounded px-1.5 py-0.5 text-ink-mute hover:bg-soft hover:text-accent"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => removeBlock(b)}
                      title={armDelete.armedId === b.id ? "3 秒内再点确认删除" : "删除"}
                      className={`flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${armDelete.armedId === b.id ? "bg-rose-500/15 text-danger" : "text-ink-mute hover:bg-soft hover:text-danger"}`}
                    >
                      {armDelete.armedId === b.id ? "确认删除?" : <Trash2 size={12} />}
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
