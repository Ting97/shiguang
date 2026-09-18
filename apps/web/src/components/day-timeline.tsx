"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseYmd, todayStr, ymd } from "@/lib/date";
import type { Activity, Block } from "@/lib/types";

const PX_PER_MIN = 0.75; // 一天 1080px，一小时 45px

interface Props {
  date: string; // YYYY-MM-DD
  blocks: Block[];
  activities: Activity[];
  onCreate: (payload: { title: string; startAt: string; endAt: string; activityId: string }) => Promise<boolean>;
  onEditBlock: (b: Block) => void;
  /** 数据是否仍在加载：加载结束后才做一次定位，避免定位到空数据 */
  loading?: boolean;
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
function hmOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export default function DayTimeline({ date, blocks, activities, onCreate, onEditBlock, loading = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastAutoDate = useRef<string | null>(null);
  const isToday = date === todayStr();
  const dayStart = useMemo(() => parseYmd(date), [date]);

  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  const [draft, setDraft] = useState<{ title: string; start: string; end: string; activityId: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, [isToday]);

  // 每个日期只在数据到位后自动定位一次：今天→当前时刻；其他日期→第一块日程（无块回顶部）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || loading || lastAutoDate.current === date) return;
    lastAutoDate.current = date;
    if (isToday) {
      el.scrollTop = Math.max(0, nowMin * PX_PER_MIN - 160);
      return;
    }
    const starts = blocks.map((b) => minOfDay(b.start_at));
    el.scrollTop = starts.length ? Math.max(0, Math.min(...starts) * PX_PER_MIN - 160) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading, isToday, blocks]);

  /** ISO → 当天分钟数（跨天块钳到 0~1440） */
  const minOfDay = (iso: string) => {
    const m = Math.floor((new Date(iso).getTime() - dayStart.getTime()) / 60_000);
    return Math.max(0, Math.min(1440, m));
  };
  const isoFromMinutes = (minutes: number) =>
    new Date(dayStart.getTime() + minutes * 60_000).toISOString();

  // 合并已记录区间 → 未记录缺口（>2 分钟）
  const gaps = useMemo(() => {
    const sorted = blocks
      .map((b) => ({ s: minOfDay(b.start_at), e: minOfDay(b.end_at) }))
      .sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number }[] = [];
    for (const seg of sorted) {
      const last = merged[merged.length - 1];
      if (last && seg.s <= last.e) last.e = Math.max(last.e, seg.e);
      else merged.push({ ...seg });
    }
    const out: { s: number; e: number }[] = [];
    let cursor = 0;
    for (const seg of merged) {
      if (seg.s - cursor > 2) out.push({ s: cursor, e: Math.min(seg.s, 1440) });
      cursor = Math.max(cursor, seg.e);
    }
    if (1440 - cursor > 2) out.push({ s: cursor, e: 1440 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, date]);

  /** 在绝对分钟处打开补录：定位到该时刻所在的 1 小时整点区间（钳进缺口；贴边不足 5 分钟回退缺口末段一小时） */
  function openSlotAt(absMin: number) {
    const gap = gaps.find((g) => absMin >= g.s && absMin <= g.e);
    if (!gap) return;
    const hourStart = Math.floor(absMin / 60) * 60;
    let s = Math.max(gap.s, hourStart);
    let e = Math.min(gap.e, hourStart + 60);
    if (e - s < 5) {
      s = Math.max(gap.s, gap.e - 60);
      e = gap.e;
    }
    setDraft({ title: "", start: hmOf(s), end: hmOf(e), activityId: "other" });
  }

  /** 点击时间轴空白（左右留白条等缺口按钮未覆盖处）→ 同样定位整点区间 */
  function containerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (draft || e.target !== e.currentTarget) return; // 只响应裸背景，缺口/日程块有自己的处理
    const rect = e.currentTarget.getBoundingClientRect();
    openSlotAt(Math.max(0, Math.min(1439, (e.clientY - rect.top) / PX_PER_MIN)));
  }

  async function submitCreate() {
    if (!draft || !draft.title.trim() || saving) return;
    const [sh, sm] = draft.start.split(":").map(Number);
    const [eh, em] = draft.end.split(":").map(Number);
    const ok = await onCreate({
      title: draft.title.trim(),
      startAt: isoFromMinutes(sh * 60 + sm),
      endAt: isoFromMinutes(eh * 60 + em),
      activityId: draft.activityId,
    });
    if (ok) setDraft(null);
  }

  return (
    <div>
      {draft && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-300">
              补录 <span className="tabular-nums">{draft.start}–{draft.end}</span>
            </span>
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
              placeholder="这段时间在做什么？"
              className="min-w-28 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-amber-400"
            />
            <input
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none"
            />
            <span className="text-xs text-slate-500">至</span>
            <input
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none"
            />
            <select
              value={draft.activityId}
              onChange={(e) => setDraft({ ...draft, activityId: e.target.value })}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none"
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}
                </option>
              ))}
            </select>
            <button onClick={() => setDraft(null)} className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-700">
              取消
            </button>
            <button
              onClick={submitCreate}
              disabled={saving || !draft.title.trim()}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium hover:bg-amber-500 disabled:opacity-40"
            >
              {saving ? "保存中…" : "补录"}
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="relative max-h-[480px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <div className="relative" style={{ height: `${1440 * PX_PER_MIN}px` }} onClick={containerClick}>
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="absolute inset-x-0 border-t border-slate-800/70" style={{ top: `${h * 60 * PX_PER_MIN}px` }}>
              <span
                className={`absolute -top-2 left-1.5 text-[10px] tabular-nums ${h % 3 === 0 ? "text-slate-400" : "text-slate-600"}`}
              >
                {h % 3 === 0 ? `${h}点` : ""}
              </span>
            </div>
          ))}

          {gaps.map((g, i) => (
            <button
              key={`gap-${i}`}
              onClick={(e) => {
                e.stopPropagation(); // 不冒泡到容器，避免二次计算覆盖
                const rect = e.currentTarget.getBoundingClientRect();
                openSlotAt(g.s + (e.clientY - rect.top) / PX_PER_MIN);
              }}
              title="点击空白处，按整点定位 1 小时补录"
              className="group absolute right-2 w-[calc(100%-3rem)] rounded border border-dashed border-slate-700/60 text-left transition hover:border-amber-500/60 hover:bg-amber-500/5"
              style={{ top: `${g.s * PX_PER_MIN}px`, height: `${Math.max((g.e - g.s) * PX_PER_MIN - 2, 8)}px` }}
            >
              {(g.e - g.s) * PX_PER_MIN >= 22 && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 text-[10px] text-slate-600 group-hover:text-amber-400/80">
                  ✦ 未记录 {hmOf(g.s)}–{hmOf(g.e)}（{(g.e - g.s) >= 60 ? `${Math.floor((g.e - g.s) / 60)}小时${(g.e - g.s) % 60 || ""}` : `${g.e - g.s}分钟`}）
                </span>
              )}
            </button>
          ))}

          {blocks.map((b) => {
            const s = minOfDay(b.start_at);
            const e = Math.max(minOfDay(b.end_at), s + 2);
            const h = (e - s) * PX_PER_MIN;
            return (
              <button
                key={b.id}
                onClick={() => onEditBlock(b)}
                title="点击修改/删除"
                className="absolute left-10 right-2 overflow-hidden rounded border-l-4 px-2 text-left transition hover:brightness-125"
                style={{
                  top: `${s * PX_PER_MIN}px`,
                  height: `${h - 2}px`,
                  backgroundColor: `${b.color}40`,
                  borderColor: b.color,
                }}
              >
                {h >= 18 && (
                  <span className="pointer-events-none flex h-full items-center gap-1.5 truncate text-xs">
                    <span>{b.icon}</span>
                    <span className="truncate font-medium text-slate-200">{b.title}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                      {hmOf(s)}–{hmOf(e)}
                    </span>
                  </span>
                )}
                {h < 18 && h >= 9 && (
                  <span className="pointer-events-none flex h-full items-center text-[10px] text-slate-300">{b.icon}</span>
                )}
              </button>
            );
          })}

          {isToday && (
            <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: `${nowMin * PX_PER_MIN}px` }}>
              <div className="relative border-t-2 border-rose-500/80">
                <span className="absolute -top-2.5 right-1 rounded bg-rose-500 px-1 text-[9px] font-bold tabular-nums text-white">
                  {hmOf(nowMin)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        提示：点击彩色块可修改 · 点击空白处自动定位整点 1 小时补录（表单内可调时间）{isToday ? " · 红线为当前时刻" : ""}
      </p>
    </div>
  );
}
