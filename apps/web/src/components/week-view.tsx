"use client";

import type { Activity, Block } from "@/lib/types";
import { localDateKey, todayStr, zhDuration, zhDate, weekName } from "@/lib/date";

interface Props {
  /** 本周 7 天（周一起） */
  days: string[];
  blocks: Block[];
  activities: Activity[];
  onPickDay: (date: string) => void;
}

const PX_PER_MIN = 0.3; // 一天 432px 竖条

/** 周视图：7 列缩略时间条 + 各类合计 */
export default function WeekView({ days, blocks, activities, onPickDay }: Props) {
  const dayStarts = new Map(days.map((d) => [d, new Date(d + "T00:00:00").getTime()]));

  const byDay = new Map<string, Block[]>();
  for (const d of days) byDay.set(d, []);
  for (const b of blocks) {
    const key = localDateKey(b.start_at); // 按本地日期归列（UTC 切片会把凌晨块放进昨天）
    byDay.get(key)?.push(b);
  }

  // 各类合计（水平堆叠条）
  const totals: Record<string, number> = {};
  for (const b of blocks) totals[b.activity_id] = (totals[b.activity_id] ?? 0) + b.duration_min;
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  const actMap = new Map(activities.map((a) => [a.id, a]));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const total = list.reduce((s, b) => s + b.duration_min, 0);
          const isToday = d === todayStr();
          return (
            <button key={d} onClick={() => onPickDay(d)} className="group text-left">
              <div className={`mb-1 rounded px-1 py-0.5 text-center text-[10px] ${isToday ? "bg-sky-600 font-bold" : "bg-slate-800/80 text-slate-400"}`}>
                {weekName(d)} {zhDate(d).replace("月", "/").replace("日", "")}
              </div>
              <div className="relative h-[432px] overflow-hidden rounded border border-slate-800 bg-slate-950/40 group-hover:border-sky-600/50">
                {Array.from({ length: 25 }, (_, h) => (
                  <div key={h} className={`absolute inset-x-0 ${h % 6 === 0 ? "border-t border-slate-800/70" : ""}`} style={{ top: `${h * 60 * PX_PER_MIN}px` }} />
                ))}
                {list.map((b) => {
                  const s = Math.max((new Date(b.start_at).getTime() - (dayStarts.get(d) ?? 0)) / 60_000, 0);
                  const e = Math.min(s + b.duration_min, 1440);
                  return (
                    <div
                      key={b.id}
                      title={`${b.icon} ${b.title} · ${zhDuration(b.duration_min)}`}
                      className="absolute inset-x-0.5 overflow-hidden rounded"
                      style={{
                        top: `${s * PX_PER_MIN}px`,
                        height: `${Math.max((e - s) * PX_PER_MIN - 1, 2)}px`,
                        backgroundColor: b.color,
                        opacity: 0.85,
                      }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-center text-[10px] tabular-nums text-slate-500">
                {total > 0 ? zhDuration(total) : "—"}
              </p>
            </button>
          );
        })}
      </div>

      {/* 各类合计 */}
      {grand > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-slate-400">
            本周共记录 <span className="font-semibold text-slate-200">{zhDuration(grand)}</span>
          </p>
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {sorted.map(([id, min]) => (
              <div key={id} style={{ width: `${(min / grand) * 100}%`, backgroundColor: actMap.get(id)?.color ?? "#64748b" }} title={`${actMap.get(id)?.name} ${zhDuration(min)}`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {sorted.map(([id, min]) => {
              const a = actMap.get(id);
              return (
                <span key={id} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a?.color }} />
                  {a?.icon} {a?.name} <span className="tabular-nums text-slate-500">{zhDuration(min)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
