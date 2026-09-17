"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface TimelineBlock {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  duration_min: number;
  activity_id: string;
  icon: string;
  color: string;
}
export interface TimelineActivity {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const PX_PER_MIN = 0.75; // 一天 1080px，一小时 45px

interface Props {
  blocks: TimelineBlock[];
  activities: TimelineActivity[];
  onCreate: (payload: { title: string; startAt: string; endAt: string; activityId: string }) => Promise<boolean>;
  onEditBlock: (b: TimelineBlock) => void;
}

/** 把 ISO 转为"当天 0 点起的分钟数"（只支持今日块） */
function minOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function hmOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
/** 当天 0 点 + 分钟偏移 → ISO */
function isoFromMinutes(minutes: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d.toISOString();
}

export default function DayTimeline({ blocks, activities, onCreate, onEditBlock }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  const [draft, setDraft] = useState<{ title: string; start: string; end: string; activityId: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 每分钟刷新"当前时刻"红线
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // 进入时滚动到当前时刻附近
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, nowMin * PX_PER_MIN - 160);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 合并已记录区间 → 计算未记录缺口（>2 分钟才算）
  const gaps = useMemo(() => {
    const sorted = [...blocks]
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
  }, [blocks]);

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
      {/* 补录表单（点击缺口后出现） */}
      {draft && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-300">补录缺口</span>
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

      {/* 时间轴主体 */}
      <div ref={containerRef} className="relative max-h-[480px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <div className="relative" style={{ height: `${1440 * PX_PER_MIN}px` }}>
          {/* 小时刻度 */}
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="absolute inset-x-0 border-t border-slate-800/70" style={{ top: `${h * 60 * PX_PER_MIN}px` }}>
              <span
                className={`absolute -top-2 left-1.5 text-[10px] tabular-nums ${h % 3 === 0 ? "text-slate-400" : "text-slate-600"}`}
              >
                {h % 3 === 0 ? `${h}点` : ""}
              </span>
            </div>
          ))}

          {/* 未记录缺口（可点击补录） */}
          {gaps.map((g, i) => (
            <button
              key={`gap-${i}`}
              onClick={() =>
                setDraft({
                  title: "",
                  start: hmOf(g.s),
                  end: hmOf(g.e),
                  activityId: "other",
                })
              }
              title="点击补录这段时间"
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

          {/* 已记录时间块 */}
          {blocks.map((b) => {
            const s = minOfDay(b.start_at);
            const e = Math.max(minOfDay(b.end_at), s + 2); // 极短块保底 2 分钟高度
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
                  backgroundColor: `${b.color}26`,
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

          {/* 当前时刻红线 */}
          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: `${nowMin * PX_PER_MIN}px` }}>
            <div className="relative border-t-2 border-rose-500/80">
              <span className="absolute -top-2.5 right-1 rounded bg-rose-500 px-1 text-[9px] font-bold tabular-nums text-white">
                {hmOf(nowMin)}
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        提示：点击彩色块可修改 · 点击虚线缺口可补录 · 红线为当前时刻（页面自动定位到当前时间附近）
      </p>
    </div>
  );
}
