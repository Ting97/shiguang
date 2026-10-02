/**
 * 周视图（= web week-view.tsx）：7 列缩略时间条 + 各类合计。
 * 每列把块钳到当天 0~1440 显示（跨天块归入它覆盖的每一天）；列小计与周合计按交集钳制，
 * 口径与 web clampMin 一致（跨周块全额计入会和列内小计对不上）。
 * 窄屏 7 列挤压不可用 → 横向滚动（web min-w-560px 同款），每列 150 设计单位。
 */
import { ScrollView, Text, View } from "@tarojs/components";
import type { Activity, Block } from "./api";
import { bjDateKey, bjToday, weekName, zhDate, zhDuration } from "./date";

const PPM = 0.6; // 一分钟的设计单位（web PX_PER_MIN 0.3px ×2），一天 864 高
const DAY_H = 1440 * PPM;

/** 块与 [fromMs, fromMs + spanMin 分钟) 区间的交集分钟数 */
function clampMin(b: Block, fromMs: number, spanMin: number) {
  const s = Math.max(Math.min((new Date(b.start_at).getTime() - fromMs) / 60_000, spanMin), 0);
  const e = Math.max(Math.min((new Date(b.end_at).getTime() - fromMs) / 60_000, spanMin), 0);
  return e - s;
}

export default function WeekView({
  days,
  blocks,
  activities,
  onPickDay,
}: {
  /** 本周 7 天（周一起） */
  days: string[];
  blocks: Block[];
  activities: Activity[];
  onPickDay: (date: string) => void;
}) {
  const dayStarts = new Map(days.map((d) => [d, Date.parse(`${d}T00:00:00+08:00`)])); // 北京零点基点

  const byDay = new Map<string, Block[]>();
  for (const d of days) byDay.set(d, []);
  for (const b of blocks) {
    // 跨天块归入它覆盖的每一天（只归开始日会漏掉跨到次日的凌晨段）
    const startKey = bjDateKey(b.start_at);
    const endKey = bjDateKey(b.end_at);
    for (const d of days) {
      if (d >= startKey && d <= endKey) byDay.get(d)?.push(b);
    }
  }

  // 各类合计：与列小计同口径，按本周 7 天交集钳制求和
  const weekFromMs = dayStarts.get(days[0]) ?? 0;
  const totals: Record<string, number> = {};
  for (const b of blocks) totals[b.activity_id] = (totals[b.activity_id] ?? 0) + clampMin(b, weekFromMs, 7 * 1440);
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  const actMap = new Map(activities.map((a) => [a.id, a]));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const today = bjToday();

  return (
    <View>
      <ScrollView className="week-scroll" scrollX enhanced showScrollbar={false}>
        <View className="week-track">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const day0 = dayStarts.get(d) ?? 0;
            // 每列合计按当天交集算，跨天块不重复计入两天
            const total = list.reduce((s, b) => s + clampMin(b, day0, 1440), 0);
            const isToday = d === today;
            return (
              <View key={d} className="week-col" hoverClass="press" hoverStayTime={80} onTap={() => onPickDay(d)}>
                <View className={`week-col-head ${isToday ? "today" : ""}`}>
                  <Text>
                    {weekName(d)} {zhDate(d).replace("月", "/").replace("日", "")}
                  </Text>
                </View>
                <View className="week-col-bar">
                  {Array.from({ length: 25 }, (_, h) =>
                    h % 6 === 0 ? <View key={h} className="week-hourline" style={{ top: `${h * 60 * PPM}rpx` }} /> : null,
                  )}
                  {list.map((b) => {
                    // 起止都钳到当天 0~1440（跨天块只显示落在当天的部分）
                    const s = Math.max(Math.min((new Date(b.start_at).getTime() - (dayStarts.get(d) ?? 0)) / 60_000, 1440), 0);
                    const e = Math.max(Math.min((new Date(b.end_at).getTime() - (dayStarts.get(d) ?? 0)) / 60_000, 1440), 0);
                    return (
                      <View
                        key={b.id}
                        className="week-block"
                        style={{
                          top: `${s * PPM}rpx`,
                          height: `${Math.max((e - s) * PPM - 2, 4)}rpx`,
                          backgroundColor: b.color,
                        }}
                      />
                    );
                  })}
                </View>
                <Text className="week-col-total">{total > 0 ? zhDuration(total) : "—"}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* 各类合计 */}
      {grand > 0 && (
        <View className="stat-wrap">
          <Text className="stat-line dim">
            本周共记录 <Text className="stat-strong">{zhDuration(grand)}</Text>
          </Text>
          <View className="stat-bar">
            {sorted.map(([id, min]) => (
              <View key={id} style={{ width: `${(min / grand) * 100}%`, backgroundColor: actMap.get(id)?.color ?? "#64748b" }} />
            ))}
          </View>
          <View className="stat-legend">
            {sorted.map(([id, min]) => {
              const a = actMap.get(id);
              return (
                <View key={id} className="legend-item">
                  <View className="legend-dot" style={{ backgroundColor: a?.color }} />
                  <Text className="legend-item-text dim">
                    {a?.icon} {a?.name} <Text className="legend-item-min">{zhDuration(min)}</Text>
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}
