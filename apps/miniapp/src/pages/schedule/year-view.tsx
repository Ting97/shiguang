/**
 * 年视图（= web year-view.tsx）：GitHub 风格热力图（列=周，行=周一~周日）+ 年度合计。
 * 逐日推进用北京口径字符串日（bjAddDays/bjMondayOf，无 Date 游走）；热力五档色引用主题令牌 --heat-*。
 * 53 列横滚：格子 22×22 设计单位（web 11px ×2）、缝 6（web 3px ×2）。
 */
import { ScrollView, Text, View } from "@tarojs/components";
import type { Activity, DayStat } from "./api";
import { bjAddDays, bjMondayOf, bjToday, zhDuration } from "./date";

type Level = 0 | 1 | 2 | 3 | 4;

export default function YearView({
  year,
  stats,
  activities,
  onPickDay,
}: {
  year: string; // YYYY
  stats: Map<string, DayStat>;
  activities: Activity[];
  onPickDay: (date: string) => void;
}) {
  // 从 1月1日 所在周的周一到 12月31日 所在周的周日，纯字符串日推进
  const today = bjToday();
  const end = `${year}-12-31`;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);

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

  const level = (min: number | undefined): Level => {
    if (!min) return 0;
    if (min < 60) return 1;
    if (min < 180) return 2;
    if (min < 360) return 3;
    return 4;
  };
  // 热力图五档色：引用主题令牌（浅色主题自动切换为浅底渐进）
  const HEAT = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];
  const MONTH_LABELS = ["1月", "", "", "4月", "", "", "7月", "", "", "10月", "", ""];

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
    <View>
      <ScrollView className="year-scroll" scrollX enhanced showScrollbar={false}>
        <View className="year-panel">
          <View className="year-inner">
            {/* 月份标签列（12 格对应 12 月，web 直接 justify-between 拉开） */}
            <View className="year-months">
              {MONTH_LABELS.map((mm, i) => (
                <Text key={i} className="year-month-label">
                  {mm}
                </Text>
              ))}
            </View>
            {weeks.map((week, wi) => (
              <View key={wi} className="year-week">
                {week.map((date) => {
                  const inYear = date.startsWith(year);
                  const s = stats.get(date);
                  const lv = inYear ? level(s?.totalMin) : -1;
                  const isToday = date === today;
                  return (
                    <View
                      key={date}
                      className={`year-cell ${!inYear ? "out" : ""} ${isToday ? "today" : ""}`}
                      style={{ backgroundColor: lv >= 0 ? HEAT[lv] : "transparent" }}
                      hoverClass={inYear ? "press" : "none"}
                      hoverStayTime={80}
                      onTap={() => inYear && onPickDay(date)}
                    />
                  );
                })}
              </View>
            ))}
          </View>
          <View className="year-scale">
            <Text className="dim">少</Text>
            {HEAT.map((c) => (
              <View key={c} className="year-scale-cell" style={{ backgroundColor: c }} />
            ))}
            <Text className="dim">多</Text>
          </View>
        </View>
      </ScrollView>

      {/* 年度统计 */}
      {grand > 0 && (
        <View className="stat-card">
          <Text className="stat-line dim">
            {year} 年共记录 <Text className="stat-strong">{zhDuration(grand)}</Text>
            <Text className="stat-sub"> · {recordedDays} 天有记录 · 平均每天 {zhDuration(Math.round(grand / (leap ? 366 : 365)))}</Text>
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
                    {a?.icon} {a?.name}
                    <Text className="legend-item-min">
                      {" "}
                      {zhDuration(min)} · {Math.round((min / grand) * 100)}%
                    </Text>
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
