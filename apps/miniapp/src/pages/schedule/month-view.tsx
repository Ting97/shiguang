/**
 * 月视图（= web month-view.tsx）：月历格 + 每日迷你结构环 + 月度统计。
 * 迷你环小程序不支持 <svg>，用 conic-gradient 圆 + 同心底打孔成环（环粗 = web strokeWidth 5px ×2）。
 * 格子用 flex 每行 7 列（WXSS 对 grid 支持不稳，用等分宽度实现）。
 */
import { Text, View } from "@tarojs/components";
import type { Activity, DayStat } from "./api";
import { bjToday, zhDuration } from "./date";

const WEEK_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

export default function MonthView({
  month,
  stats,
  activities,
  onPickDay,
}: {
  month: string; // YYYY-MM-01
  stats: Map<string, DayStat>;
  activities: Activity[];
  onPickDay: (date: string) => void;
}) {
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
  const today = bjToday();

  return (
    <View>
      <View className="month-grid">
        {WEEK_HEADS.map((w) => (
          <View key={w} className="month-head-cell">
            <Text>{w}</Text>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={`e-${i}`} className="month-cell empty" />;
          const s = stats.get(date);
          const isToday = date === today;
          const isFuture = date > today;
          const donut = s && s.totalMin > 0;
          return (
            <View
              key={date}
              className={`month-cell ${isToday ? "today" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => onPickDay(date)}
            >
              <Text className={`month-day ${isToday ? "today" : ""}`}>{Number(date.slice(8))}</Text>
              {donut ? (
                <>
                  <MiniDonut byActivity={s!.byActivity} actMap={actMap} size={60} />
                  <Text className="month-min">{zhDuration(s!.totalMin)}</Text>
                </>
              ) : (
                /* 未来日期没有"未记录"义务，仅过去/今天温和提示 */
                !isFuture && <Text className="month-none">未记录</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* 月度统计 */}
      {grand > 0 && (
        <View className="stat-card">
          <Text className="stat-line dim">
            {m} 月共记录 <Text className="stat-strong">{zhDuration(grand)}</Text>
            <Text className="stat-sub"> · {recordedDays} 天有记录 · 日均 {zhDuration(Math.round(grand / recordedDays))}</Text>
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

/** 迷你结构环（web MiniDonut 的 conic-gradient 版）：30px 直径、5px 环粗 → 60/10 设计单位 */
function MiniDonut({
  byActivity,
  actMap,
  size,
}: {
  byActivity: Record<string, number>;
  actMap: Map<string, Activity>;
  size: number;
}) {
  const total = Object.values(byActivity).reduce((s, v) => s + v, 0);
  const stops: string[] = [];
  let acc = 0;
  for (const [id, min] of Object.entries(byActivity).sort((a, b) => b[1] - a[1])) {
    const from = (acc / total) * 360;
    acc += min;
    const to = (acc / total) * 360;
    stops.push(`${actMap.get(id)?.color ?? "#64748b"} ${from}deg ${to}deg`);
  }
  const hole = size - 10; // 环粗 10 设计单位（web strokeWidth 5 ×2）
  return (
    <View className="mini-donut" style={{ width: `${size}rpx`, height: `${size}rpx`, background: `conic-gradient(${stops.join(", ")})` }}>
      <View className="mini-donut-hole" style={{ width: `${hole}rpx`, height: `${hole}rpx` }} />
    </View>
  );
}
