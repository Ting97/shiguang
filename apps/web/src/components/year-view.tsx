"use client";

import type { Activity, DayStat } from "@/lib/types";
import { zhDuration } from "@/lib/date";
import { bjToday, bjAddDays, bjMondayOf } from "@/lib/date"; // 北京口径日历（本地构造器/游走在海外设备日界错位）

interface Props {
  year: string; // YYYY
  stats: Map<string, DayStat>;
  activities: Activity[];
  onPickDay: (date: string) => void;
}

/** 年视图：GitHub 风格热力图（列=周，行=周一~周日）+ 年度合计 */
export default function YearView({ year, stats, activities, onPickDay }: Props) {
  const y = Number(year);
  // 北京口径日历：从 1月1日 所在周的周一（bjMondayOf）到 12月31日 所在周的周日，纯字符串日推进（无 Date 游走）
  const today = bjToday();
  const end = `${year}-12-31`;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

  const weeks: string[][] = [];
  let cursor = bjMondayOf(`${year}-01-01`);
  while (cursor <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = bjAddDays(cursor, 1);
    }
    weeks.push(week);
  }

  const level = (min: number | undefined): 0 | 1 | 2 | 3 | 4 => {
    if (!min) return 0;
    if (min < 60) return 1;
    if (min < 180) return 2;
    if (min < 360) return 3;
    return 4;
  };
  // 热力图五档色：引用主题令牌（浅色主题自动切换为浅底渐进）
  const COLORS = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

  // 年度合计
  const totals: Record<string, number> = {};
  let grand = 0;
  let recordedDays = 0;
  for (const s of stats.values()) {
    if (s.totalMin > 0) recordedDays++;
    grand += s.totalMin;
    for (const [id, min] of Object.entries(s.byActivity)) totals[id] = (totals[id] ?? 0) + min;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const actMap = new Map(activities.map((a) => [a.id, a]));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line-soft bg-bg/40 p-3">
        <div className="flex gap-[3px]">
          {/* 月份标签 */}
          <div className="mr-1 flex flex-col justify-between py-[1px] text-[9px] text-ink-faint">
            {["1月", "", "", "4月", "", "", "7月", "", "", "10月", "", ""].slice(0, 12).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((date) => {
                const inYear = date.startsWith(year);
                const s = stats.get(date);
                const lv = inYear ? level(s?.totalMin) : -1;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    onClick={() => inYear && onPickDay(date)}
                    disabled={!inYear}
                    title={inYear ? `${date} · ${s ? zhDuration(s.totalMin) : "未记录"}` : ""}
                    className={`h-[11px] w-[11px] rounded-[2px] max-sm:relative max-sm:after:absolute max-sm:after:inset-[-3px] ${inYear ? "transition hover:ring-1 hover:ring-sky-400" : "opacity-0"} ${isToday ? "ring-1 ring-rose-400" : ""}`}
                    style={{ backgroundColor: lv >= 0 ? COLORS[lv] : "transparent" }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-ink-dim">
          少
          {COLORS.map((c) => (
            <span key={c} className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: c }} />
          ))}
          多
        </div>
      </div>

      {/* 年度统计 */}
      {grand > 0 && (
        <div className="mt-4 rounded-lg border border-line-soft bg-bg/40 p-4">
          <p className="mb-2 text-xs text-ink-mute">
            {year} 年共记录 <span className="font-semibold text-ink">{zhDuration(grand)}</span>
            <span className="ml-2 text-ink-dim">· {recordedDays} 天有记录 · 平均每天 {zhDuration(Math.round(grand / (leap ? 366 : 365)))}</span>
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
                <span key={id} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a?.color }} />
                  {a?.icon} {a?.name}
                  <span className="tabular-nums text-ink-dim">{zhDuration(min)} · {Math.round((min / grand) * 100)}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
