/**
 * 当日结构环形图（= web day-donut.tsx）：左环右图例。
 * 小程序不支持 <svg>，环用 Canvas 2d 画（透明底 + 各活动色弧段，圆环底色取主题 --chart-track）；
 * 主题切换（深/浅）会影响底色，故监听 useTheme 重画。
 */
import { useEffect, useRef, useState } from "react";
import { Canvas, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { Activity } from "./api";
import { useTheme } from "../../lib/theme";

/** --chart-track 的深/浅取值（app.scss 令牌同源；canvas 里取不到 CSS 变量，就地映射） */
const TRACK: Record<"dark" | "light", string> = { dark: "#1e293b", light: "#e2e8f0" };

let donutSeq = 0; // 同页多实例的 canvas 节点 id 防撞

export default function DayDonut({
  byActivity,
  activities,
  size = 200, // 直径（web 100px ×2 设计单位）
  thickness = 24, // 环粗（web DayDonut 默认 14 → 28；日视图传 12 → 24）
}: {
  byActivity: Record<string, number>;
  activities: Activity[];
  size?: number;
  thickness?: number;
}) {
  const { theme } = useTheme();
  const [idRef] = useState(() => `donut-${++donutSeq}`); // 实例级稳定 id（useState 惰性初值只算一次）
  const segsRef = useRef("");

  const total = Object.values(byActivity).reduce((s, v) => s + v, 0);
  const actMap = new Map(activities.map((a) => [a.id, a]));

  let offset = 0;
  const segments = Object.entries(byActivity)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, min]) => {
      const frac = total > 0 ? min / total : 0;
      const seg = { id, min, color: actMap.get(id)?.color ?? "#64748b", frac, offset };
      offset += frac;
      return seg;
    });

  // 数据或主题变化即重画（键串比对避免同值重画；绘制成功才记键，node 未就绪时定时重试）
  const segKey = `${theme}|${segments.map((s) => `${s.id}:${s.color}:${s.frac.toFixed(4)}`).join(",")}`;
  const retryRef = useRef(0);
  useEffect(() => {
    if (segsRef.current === segKey) return;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey]);

  function draw() {
    Taro.createSelectorQuery()
      .select(`#${idRef}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) {
          // canvas 节点晚于首次 effect 就绪（首屏异步渲染）：有限次重试
          if (retryRef.current < 5) {
            retryRef.current += 1;
            setTimeout(draw, 300);
          }
          return;
        }
        retryRef.current = 0;
        try {
          const canvas = item.node as HTMLCanvasElement;
          const info = Taro.getSystemInfoSync();
          const dpr = info.pixelRatio || 2;
          // style 是 750 设计单位（rpx），位图要按真实像素 ×dpr
          const unitPx = (info.windowWidth || 375) / 750;
          const px = Math.max(1, Math.round(size * unitPx));
          const lw = Math.max(1, thickness * unitPx);
          canvas.width = px * dpr;
          canvas.height = px * dpr;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.scale(dpr, dpr);
          const c = px / 2;
          const r = Math.max(1, (px - lw) / 2);
          // 起点转到 12 点方向（= web -rotate-90）
          ctx.translate(c, c);
          ctx.rotate(-Math.PI / 2);
          ctx.lineCap = "butt";
          // 底环
          ctx.lineWidth = lw;
          ctx.strokeStyle = TRACK[theme];
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
          // 各活动弧段
          for (const seg of segments) {
            ctx.strokeStyle = seg.color;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.max(seg.frac * Math.PI * 2, 0.0001));
            ctx.stroke();
            ctx.rotate(seg.frac * Math.PI * 2);
          }
          segsRef.current = segKey; // 绘制成功才记账，失败保留旧键以便重试
        } catch {
          /* canvas 不可用（低版本基础库）时静默：右侧图例仍可读 */
        }
      });
  }

  return (
    <View className="donut-row">
      <Canvas type="2d" id={idRef} className="donut-canvas" style={{ width: `${size}rpx`, height: `${size}rpx` }} />
      <View className="donut-legend">
        {total === 0 && <Text className="donut-empty">暂无记录</Text>}
        {segments.slice(0, 5).map((s) => {
          const a = actMap.get(s.id);
          return (
            <View key={s.id} className="legend-line">
              <View className="legend-dot" style={{ backgroundColor: s.color }} />
              <View className="legend-name">
                <Text className="legend-icon">{a?.icon ?? "📌"}</Text>
                <Text className="legend-text">{a?.name ?? "其他"}</Text>
              </View>
              <Text className="legend-pct">{Math.round((s.min / total) * 100)}%</Text>
            </View>
          );
        })}
        {segments.length > 5 && <Text className="donut-more">等 {segments.length - 5} 类未展示</Text>}
      </View>
    </View>
  );
}
