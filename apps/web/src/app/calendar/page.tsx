"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/nav";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import WeekView from "@/components/week-view";
import MonthView from "@/components/month-view";
import YearView from "@/components/year-view";
import BlockEditor, { type BlockDraft } from "@/components/block-editor";
import {
  addDays, localDateKey, parseYmd, startOfMonth, startOfWeek, startOfYear, todayStr,
  weekName, ymd, zhDate, zhDuration,
} from "@/lib/date";
import type { Activity, Block, DayStat } from "@/lib/types";

type View = "day" | "week" | "month" | "year";
const pad = (n: number) => String(n).padStart(2, "0");
const zhTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function CalendarPage() {
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState<string>(todayStr()); // 当前锚定日期
  const [activities, setActivities] = useState<Activity[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]); // 日/周视图原始块
  const [stats, setStats] = useState<Map<string, DayStat>>(new Map()); // 月/年聚合
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadActivities = useCallback(async () => {
    const r = await fetch("/api/activities");
    setActivities((await r.json()).activities ?? []);
  }, []);
  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  // 区间计算
  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    if (view === "month") {
      const from = startOfMonth(anchor);
      const [y, m] = from.split("-").map(Number);
      return { from, to: ymd(new Date(y, m, 0)) };
    }
    const from = startOfYear(anchor);
    return { from, to: `${from.slice(0, 4)}-12-31` };
  }, [view, anchor]);

  // 加载数据（日/周用原始块，月/年用聚合）
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      if (view === "day" || view === "week") {
        const r = await fetch(`/api/blocks/range?${qs}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setBlocks(j.blocks ?? []);
      } else {
        const r = await fetch(`/api/stats/range?${qs}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setStats(new Map((j.days ?? []).map((d: DayStat) => [d.date, d])));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [view, range.from, range.to]);
  useEffect(() => {
    load();
  }, [load]);

  // ----- 日期导航 -----
  function shift(dir: 1 | -1) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else if (view === "month") {
      const d = parseYmd(anchor);
      d.setMonth(d.getMonth() + dir);
      setAnchor(ymd(d));
    } else setAnchor(`${Number(anchor.slice(0, 4)) + dir}-06-15`);
  }

  // ----- 日视图编辑/补录 -----
  function startEdit(b: Block) {
    setEditing({ id: b.id, title: b.title, start: zhTime(b.start_at), end: zhTime(b.end_at), activityId: b.activity_id });
  }
  async function saveEdit() {
    if (!editing) return;
    if (editing.end <= editing.start) {
      setErr("结束时间必须晚于开始时间");
      return;
    }
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    const withHM = (iso: string, hm: string) => {
      const d = new Date(iso);
      const [h, m] = hm.split(":").map(Number);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const r = await fetch(`/api/blocks/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editing.title.trim() || b.title,
        startAt: withHM(b.start_at, editing.start),
        endAt: withHM(b.end_at, editing.end),
        activityId: editing.activityId,
      }),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? "保存失败"); return; }
    setEditing(null);
    await load();
  }
  async function removeEdit() {
    if (!editing) return;
    const b = blocks.find((x) => x.id === editing.id);
    if (!b || !window.confirm(`删除这条日程？\n「${b.title}」`)) return;
    const r = await fetch(`/api/blocks/${editing.id}`, { method: "DELETE" });
    if (!r.ok) { setErr("删除失败"); return; }
    setEditing(null);
    await load();
  }
  async function createBlock(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    const r = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? "补录失败"); return false; }
    await load();
    return true;
  }

  // ----- 标题与统计 -----
  // 本地日期过滤（ISO 字符串 UTC 切片会把凌晨块筛掉）
  const dayBlocks = blocks.filter((b) => localDateKey(b.start_at) === anchor);
  const dayStat: Record<string, number> = {};
  for (const b of dayBlocks) dayStat[b.activity_id] = (dayStat[b.activity_id] ?? 0) + b.duration_min;
  const weekDays = useMemo(() => {
    const from = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchor]);

  const title =
    view === "day" ? `${anchor.slice(0, 4)}年${zhDate(anchor)} ${weekName(anchor)}` :
    view === "week" ? `${range.from.slice(0, 4)}年${zhDate(range.from)} – ${zhDate(range.to)}` :
    view === "month" ? `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月` :
    `${anchor.slice(0, 4)}年`;

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <Nav />

        <div className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50 hover:bg-slate-800/80">‹</button>
            <h1 className="text-gradient min-w-44 text-center text-lg font-semibold">{title}</h1>
            <button onClick={() => shift(1)} className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50 hover:bg-slate-800/80">›</button>
            <button onClick={() => setAnchor(todayStr())} className="ml-1 whitespace-nowrap rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 transition hover:border-sky-500/50 hover:bg-slate-800/80">今天</button>
          </div>
          <div className="flex rounded-full border border-white/10 bg-slate-950/50 p-0.5 text-xs">
            {([["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"]] as [View, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 sm:px-3.5 ${
                  view === v
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>
        )}
        {loading && <p className="py-8 text-center text-xs text-slate-500">加载中…</p>}

        {!loading && view === "day" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <div>
              {editing && (
                <div className="mb-3">
                  <BlockEditor draft={editing} activities={activities} onChange={setEditing} onSave={saveEdit} onCancel={() => setEditing(null)} onDelete={removeEdit} />
                </div>
              )}
              <DayTimeline date={anchor} blocks={dayBlocks} activities={activities} onCreate={createBlock} onEditBlock={startEdit} />
            </div>
            <aside className="glass rounded-2xl p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">当日结构</h2>
              <DayDonut byActivity={dayStat} activities={activities} />
              <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
                共 {dayBlocks.length} 段 · {zhDuration(dayBlocks.reduce((s, b) => s + b.duration_min, 0))}
              </div>
            </aside>
          </div>
        )}
        {!loading && view === "week" && (
          <WeekView days={weekDays} blocks={blocks} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
        )}
        {!loading && view === "month" && (
          <MonthView month={startOfMonth(anchor)} stats={stats} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
        )}
        {!loading && view === "year" && (
          <YearView year={anchor.slice(0, 4)} stats={stats} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
        )}
      </div>
    </main>
  );
}
