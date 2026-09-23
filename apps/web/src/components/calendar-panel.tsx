"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import WeekView from "@/components/week-view";
import MonthView from "@/components/month-view";
import YearView from "@/components/year-view";
import BlockEditor, { type BlockDraft } from "@/components/block-editor";
import DayReviewCard from "@/app/calendar/day-review-card";
import WeekReviewCard from "@/app/calendar/week-review-card";
import MonthReviewCard from "@/app/calendar/month-review-card";
import YearReviewCard from "@/app/calendar/year-review-card";
import {
  addDays, parseYmd, startOfMonth, startOfWeek, startOfYear, todayStr,
  weekName, ymd, zhDate, zhDuration,
} from "@/lib/date";
import type { Activity, Block, DayStat } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";

/** 日程页 · 日历子页：原 /calendar 页的四视图（日/周/月/年）+ AI 复盘，逻辑不变整体平移 */
export default function CalendarPanel({ initialAnchor }: { initialAnchor?: string }) {
  const [view, setView] = useState<"day" | "week" | "month" | "year">("day");
  const [anchor, setAnchor] = useState<string>(todayStr()); // 当前锚定日期
  // ?date= 直达锚定：参数在父层 useEffect 里才解析出来（晚于本组件首帧），定义后一次性采纳
  const anchoredRef = useRef(false);
  useEffect(() => {
    if (initialAnchor && !anchoredRef.current) {
      anchoredRef.current = true;
      setAnchor(initialAnchor);
    }
  }, [initialAnchor]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]); // 日/周视图原始块
  const [stats, setStats] = useState<Map<string, DayStat>>(new Map()); // 月/年聚合
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadActivities = useCallback(async () => {
    const j = await api<any>("/api/activities");
    setActivities(j.activities ?? []);
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

  // 加载数据（日/周用原始块，月/年用聚合）；seq 守卫：锚定快速切换时只让最新请求落地
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr(null);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      if (view === "day" || view === "week") {
        const j = await api<any>(`/api/blocks/range?${qs}`);
        if (seq !== loadSeq.current) return; // 锚定快速切换时旧响应可能后到，丢弃过期数据
        setBlocks(j.blocks ?? []);
      } else {
        const j = await api<any>(`/api/stats/range?${qs}`);
        if (seq !== loadSeq.current) return;
        setStats(new Map((j.days ?? []).map((d: DayStat) => [d.date, d])));
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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
    setEditing({ id: b.id, title: b.title, start: zhTimeC(b.start_at), end: zhTimeC(b.end_at), activityId: b.activity_id });
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
    try {
      await api<any>(`/api/blocks/${editing.id}`, "PATCH", {
        title: editing.title.trim() || b.title,
        startAt: withHM(b.start_at, editing.start),
        endAt: withHM(b.end_at, editing.end),
        activityId: editing.activityId,
      });
    } catch (e) {
      if (e instanceof ApiClientError) { setErr(e.message === "操作失败" ? "保存失败" : e.message); return; }
      setErr(e instanceof Error ? e.message : String(e)); // 非接口错误也就地提示，不外抛（外抛会触发整页自愈刷新）
      return;
    }
    setEditing(null);
    await load();
  }
  async function removeEdit() {
    if (!editing) return;
    // 确认交互在 BlockEditor 的两步删除按钮内完成（3 秒内二次点按才会走到这里）
    try {
      await api<any>(`/api/blocks/${editing.id}`, "DELETE");
    } catch (e) {
      // 原 fetch 版不解析响应体，任何失败统一「删除失败」
      if (e instanceof ApiClientError) { setErr("删除失败"); return; }
      setErr(e instanceof Error ? e.message : String(e)); // 同上：不外抛
      return;
    }
    setEditing(null);
    await load();
  }
  async function createBlock(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    try {
      await api<any>("/api/blocks", "POST", payload);
    } catch (e) {
      if (e instanceof ApiClientError) { setErr(e.message === "操作失败" ? "补录失败" : e.message); return false; }
      throw e;
    }
    await load();
    return true;
  }

  // ----- 标题与统计 -----
  // 本地日期过滤（ISO 字符串 UTC 切片会把凌晨块筛掉）
  // range API 已按「区间与当天有交集」返回：跨天块（如昨晚→今早的睡眠）也要显示/统计，
  // 不能再按 start_at 的日期过滤（会把凌晨占用段筛没，导致"看得见的冲突缺口"）
  const dayBlocks = blocks;
  // 统计口径与月/年视图统一（stats/range 的交集钳制）：跨天块只计落在当天的部分
  const dayStartMs = new Date(`${anchor}T00:00:00`).getTime();
  const dayEndMs = dayStartMs + 86_400_000;
  const dayClampedMin = (b: { start_at: string; end_at: string }) => {
    const s = new Date(b.start_at).getTime();
    const e = new Date(b.end_at).getTime();
    return Math.max(0, Math.round((Math.min(e, dayEndMs) - Math.max(s, dayStartMs)) / 60_000));
  };
  const dayStat: Record<string, number> = {};
  for (const b of dayBlocks) dayStat[b.activity_id] = (dayStat[b.activity_id] ?? 0) + dayClampedMin(b);
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
    <>
      <div className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50 hover:bg-elevated/80">‹</button>
          <h2 className="text-gradient min-w-44 text-center text-lg font-semibold">{title}</h2>
          <button onClick={() => shift(1)} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50 hover:bg-elevated/80">›</button>
          <button onClick={() => setAnchor(todayStr())} className="ml-1 whitespace-nowrap rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-ink-soft transition hover:border-sky-500/50 hover:bg-elevated/80">今天</button>
        </div>
        <div className="flex rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs">
          {([["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"]] as [typeof view, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 sm:px-3.5 ${
                view === v
                  ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                  : "text-ink-mute hover:bg-wash hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{err}</div>
      )}
      {loading && <p className="py-8 text-center text-xs text-ink-dim">加载中…</p>}

      {!loading && view === "day" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          {/* 移动端把当日结构与 AI 小结排在时间轴前（order-first），不再被 480px 时间轴压在下面 */}
          <aside className="glass order-first mb-0 rounded-2xl p-4 lg:order-none lg:mb-0">
            <h3 className="mb-3 text-sm font-semibold text-ink-soft">当日结构</h3>
            <DayDonut byActivity={dayStat} activities={activities} size={100} thickness={12} />
            <div className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-dim">
              共 {dayBlocks.length} 段 · {zhDuration(dayBlocks.reduce((s, b) => s + dayClampedMin(b), 0))}
            </div>
            <DayReviewCard date={anchor} hasRecords={dayBlocks.length > 0} notify={setErr} />
          </aside>
          <div className="order-last lg:order-none">
            {editing && (
              <div className="mb-3">
                <BlockEditor draft={editing} activities={activities} onChange={setEditing} onSave={saveEdit} onCancel={() => setEditing(null)} onDelete={removeEdit} />
              </div>
            )}
            <DayTimeline date={anchor} blocks={dayBlocks} activities={activities} onCreate={createBlock} onEditBlock={startEdit} loading={loading} />
          </div>
        </div>
      )}
      {!loading && view === "week" && (
        <>
          <WeekView days={weekDays} blocks={blocks} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
          <WeekReviewCard
            weekStart={weekDays[0]}
            weekEnd={weekDays[6]}
            hasRecords={blocks.length > 0}
            notify={setErr}
          />
        </>
      )}
      {!loading && view === "month" && (
        <>
        <MonthView month={startOfMonth(anchor)} stats={stats} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
        <MonthReviewCard month={anchor.slice(0, 7)} hasRecords={[...stats.values()].length > 0} notify={setErr} />
        </>
      )}
      {!loading && view === "year" && (
        <>
        <YearView year={anchor.slice(0, 4)} stats={stats} activities={activities} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
        <YearReviewCard year={anchor.slice(0, 4)} hasRecords={[...stats.values()].length > 0} notify={setErr} />
        </>
      )}
    </>
  );
}

const padC = (n: number) => String(n).padStart(2, "0");
const zhTimeC = (iso: string) => {
  const d = new Date(iso);
  return `${padC(d.getHours())}:${padC(d.getMinutes())}`;
};
