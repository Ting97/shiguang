"use client";

import type { Activity, DayStat } from "@/lib/types";
import { zhDuration, zhDate } from "@/lib/date";

interface Props {
  month: string; // YYYY-MM-01
  stats: Map<string, DayStat>;
  activities: Activity[];
  onPickDay: (date: string) => void;
}

/** 月视图：月历格 + 每日迷你结构环 + 月度统计 */
export default function MonthView({ month, stats, activities, onPickDay }: Props) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一为 0
  const actMap = new Map(activities.map((a) => [a.id, a]));

  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`),
  ];

  // 月度各类合计
  const totals: Record<string, number> = {};
  let grand = 0;
  let recordedDays = 0;
  for (const s of stats.values()) {
    recordedDays++;
    grand += s.totalMin;
    for (const [id, min] of Object.entries(s.byActivity)) totals[id] = (totals[id] ?? 0) + min;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] text-slate-500">
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`e-${i}`} />;
          const s = stats.get(date);
          const isToday = date === todayStr;
          const donut = s && s.totalMin > 0;
          return (
            <button
              key={date}
              onClick={() => onPickDay(date)}
              className={`flex h-[74px] flex-col items-center justify-center gap-1 rounded-lg border text-center transition ${
                isToday ? "border-sky-500 bg-sky-500/10" : "border-slate-800 bg-slate-950/40 hover:border-slate-600"
              }`}
            >
              <span className={`text-xs tabular-nums ${isToday ? "font-bold text-sky-300" : "text-slate-400"}`}>
                {Number(date.slice(8))}
              </span>
              {donut ? (
                <>
                  <MiniDonut byActivity={s!.byActivity} actMap={actMap} size={30} />
                  <span className="text-[9px] tabular-nums text-slate-500">
                    {zhDuration(s!.totalMin)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-slate-700">未记录</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 月度统计 */}
      {grand > 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <p className="mb-2 text-xs text-slate-400">
            {m} 月共记录 <span className="font-semibold text-slate-200">{zhDuration(grand)}</span>
            <span className="ml-2 text-slate-500">· {recordedDays} 天有记录 · 日均 {zhDuration(Math.round(grand / recordedDays))}</span>
          </p>
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {sorted.map(([id, min]) => (
              <div key={id} style={{ width: `${(min / grand) * 100}%`, backgroundColor: actMap.get(id)?.color ?? "#64748b" }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {sorted.map(([id, min]) => {
              const a = actMap.get(id);
              return (
                <span key={id} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a?.color }} />
                  {a?.icon} {a?.name}
                  <span className="tabular-nums text-slate-500">{zhDuration(min)} · {Math.round((min / grand) * 100)}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniDonut({ byActivity, actMap, size }: { byActivity: Record<string, number>; actMap: Map<string, Activity>; size: number }) {
  const total = Object.values(byActivity).reduce((s, v) => s + v, 0);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} className="-rotate-90">
      {Object.entries(byActivity)
        .sort((a, b) => b[1] - a[1])
        .map(([id, min]) => {
          const frac = min / total;
          const el = (
            <circle
              key={id}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={actMap.get(id)?.color ?? "#64748b"}
              strokeWidth={5}
              strokeDasharray={`${frac * c} ${c - frac * c}`}
              strokeDashoffset={-offset}
            />
          );
          offset += frac * c;
          return el;
        })}
    </svg>
  );
}
