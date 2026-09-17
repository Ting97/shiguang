"use client";

import type { Activity } from "@/lib/types";

interface Props {
  /** activityId → 分钟 */
  byActivity: Record<string, number>;
  activities: Activity[];
  size?: number; // 直径 px
  thickness?: number;
}

/** 每日/周期结构环形图（SVG） */
export default function DayDonut({ byActivity, activities, size = 120, thickness = 14 }: Props) {
  const total = Object.values(byActivity).reduce((s, v) => s + v, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const actMap = new Map(activities.map((a) => [a.id, a]));

  let offset = 0;
  const segments = Object.entries(byActivity)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, min]) => {
      const frac = total > 0 ? min / total : 0;
      const seg = { id, min, color: actMap.get(id)?.color ?? "#64748b", dash: frac * c, gap: c - frac * c, offset };
      offset += frac * c;
      return seg;
    });

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={thickness} />
        {segments.map((s) => (
          <circle
            key={s.id}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        {total === 0 && <p className="text-xs text-slate-600">暂无记录</p>}
        {segments.slice(0, 5).map((s) => {
          const a = actMap.get(s.id);
          return (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="flex-1 truncate text-slate-300">
                {a?.icon ?? "📌"} {a?.name ?? "其他"}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {Math.round((s.min / total) * 100)}%
              </span>
            </div>
          );
        })}
        {segments.length > 5 && (
          <p className="text-[10px] text-slate-600">等 {segments.length - 5} 类未展示</p>
        )}
      </div>
    </div>
  );
}
