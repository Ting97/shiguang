"use client";

import type { Activity, Block } from "@/lib/types";
import { bjToday, zhDuration, zhDate, weekName } from "@/lib/date";
import { bjDateKey } from "@/lib/bj-time"; // 北京口径：localDateKey/todayStr 按宿主时区，海外设备与日视图日界不一致

interface Props {
  /** 本周 7 天（周一起） */
  days: string[];
  blocks: Block[];
  activities: Activity[];
  onPickDay: (date: string) => void;
}

const PX_PER_MIN = 0.3; // 一天 432px 竖条

/** 块与 [fromMs, fromMs + spanMin 分钟) 区间的交集分钟数（跨天块只计落在区间内的部分，列小计与周合计同口径） */
const clampMin = (b: Block, fromMs: number, spanMin: number) => {
  const s = Math.max(Math.min((new Date(b.start_at).getTime() - fromMs) / 60_000, spanMin), 0);
  const e = Math.max(Math.min((new Date(b.end_at).getTime() - fromMs) / 60_000, spanMin), 0);
  return e - s;
};

/** 周视图：7 列缩略时间条 + 各类合计 */
export default function WeekView({ days, blocks, activities, onPickDay }: Props) {
  const dayStarts = new Map(days.map((d) => [d, Date.parse(`${d}T00:00:00+08:00`)])); // 北京零点基点（本地零点在海外设备把当天块算偏 8 小时）

  const byDay = new Map<string, Block[]>();
  for (const d of days) byDay.set(d, []);
  for (const b of blocks) {
    // 跨天块归入它覆盖的每一天（每列按当天的交集钳制显示），只归开始日会漏掉跨到次日的凌晨段
    const startKey = bjDateKey(b.start_at);
    const endKey = bjDateKey(b.end_at);
    for (const d of days) {
      if (d >= startKey && d <= endKey) byDay.get(d)?.push(b);
    }
  }

  // 各类合计：与列小计同口径，按本周 7 天交集钳制求和（跨周块全额计入会和列内小计对不上）
  const weekFromMs = dayStarts.get(days[0]) ?? 0;
  const totals: Record<string, number> = {};
  for (const b of blocks) totals[b.activity_id] = (totals[b.activity_id] ?? 0) + clampMin(b, weekFromMs, 7 * 1440);
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  const actMap = new Map(activities.map((a) => [a.id, a]));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* 窄屏 7 列挤压不可用：横向滚动 + 每列最小可读宽度，滚动提示渐变 */}
      <div className="relative">
        <div className="scrollbar-none overflow-x-auto">
          <div className="grid min-w-[560px] grid-cols-7 gap-1.5 sm:min-w-0">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const day0 = dayStarts.get(d) ?? 0;
          // 每列合计按当天交集算，跨天块不重复计入两天
          const total = list.reduce((s, b) => s + clampMin(b, day0, 1440), 0);
          const isToday = d === bjToday();
          return (
            <button key={d} onClick={() => onPickDay(d)} className="group text-left">
              <div className={`mb-1 rounded px-1 py-0.5 text-center text-[10px] ${isToday ? "bg-sky-600 font-bold" : "bg-elevated/80 text-ink-mute"}`}>
                {weekName(d)} {zhDate(d).replace("月", "/").replace("日", "")}
              </div>
              <div className="relative h-[432px] overflow-hidden rounded border border-line-soft bg-bg/40 group-hover:border-sky-600/50">
                {Array.from({ length: 25 }, (_, h) => (
                  <div key={h} className={`absolute inset-x-0 ${h % 6 === 0 ? "border-t border-line-soft/70" : ""}`} style={{ top: `${h * 60 * PX_PER_MIN}px` }} />
                ))}
                {list.map((b) => {
                  // 起止都钳到当天 0~1440（跨天块只显示落在当天的部分）
                  const s = Math.max(Math.min((new Date(b.start_at).getTime() - (dayStarts.get(d) ?? 0)) / 60_000, 1440), 0);
                  const e = Math.max(Math.min((new Date(b.end_at).getTime() - (dayStarts.get(d) ?? 0)) / 60_000, 1440), 0);
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
              <p className="mt-1 text-center text-[10px] tabular-nums text-ink-dim">
                {total > 0 ? zhDuration(total) : "—"}
              </p>
            </button>
          );
        })}
          </div>
        </div>
      </div>

      {/* 各类合计 */}
      {grand > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-ink-mute">
            本周共记录 <span className="font-semibold text-ink">{zhDuration(grand)}</span>
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
                <span key={id} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a?.color }} />
                  {a?.icon} {a?.name} <span className="tabular-nums text-ink-dim">{zhDuration(min)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
