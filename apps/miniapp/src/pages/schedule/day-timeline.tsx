/**
 * 24h 日时间轴（= web day-timeline.tsx）：
 * - 一天 1440 分钟 × 1.5 设计单位/分（web 0.75px/分 ×2），高 2160，容器 960 内滚（web max-h-480 ×2）；
 * - 彩色块点击 → 编辑（onEditBlock）；虚线缺口/裸背景点击 → 按整点定位 1 小时补录（onOpenSlot）；
 * - 今天画红线（北京时刻），数据到位后自动定位：今天→当前时刻，其他日→第一块。
 * 交互换算坑：ScrollView scrollTop 与 boundingClientRect 都是真实 px，
 * 设计单位 ↔ px 用 unitPx = windowWidth/750 换算（designWidth 750）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { Block } from "./api";
import { bjNowMin, bjToday } from "./date";

const PPM = 1.5; // 一分钟的设计单位（web PX_PER_MIN 0.75px ×2）
const AUTO_OFFSET = 320; // 自动定位时目标线以上留白（web 160px ×2）
const DAY_H = 1440 * PPM; // 轴总高 2160

/** 设计单位 → 真实 px（滚动定位/点击坐标换算用，取一次即可） */
function unitPx(): number {
  try {
    return (Taro.getSystemInfoSync().windowWidth || 375) / 750;
  } catch {
    return 0.5;
  }
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
function hmOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

interface Props {
  date: string; // YYYY-MM-DD
  blocks: Block[];
  loading?: boolean;
  onEditBlock: (b: Block) => void;
  /** 在 absMin 分钟处打开补录（已解析成整点槽位 HH:MM–HH:MM） */
  onOpenSlot: (startHm: string, endHm: string) => void;
}

export default function DayTimeline({ date, blocks, loading = false, onEditBlock, onOpenSlot }: Props) {
  const lastAutoDate = useRef<string | null>(null);
  const isToday = date === bjToday(); // 锚定日对比北京今天（本地口径在海外设备会差一天）
  const dayStartMs = useMemo(() => Date.parse(`${date}T00:00:00+08:00`), [date]); // 北京零点基点

  // 初值固定 null 不画线：首帧用真实时钟会闪，挂载后 interval 校准（web 同款）
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!isToday) return;
    setNowMin(bjNowMin());
    const t = setInterval(() => setNowMin(bjNowMin()), 60_000);
    return () => clearInterval(t);
  }, [isToday]);

  /** ISO → 当天分钟数（基点北京零点；跨午夜块可为负，钳到 0~1440） */
  const minOfDay = (iso: string) => {
    const m = Math.floor((new Date(iso).getTime() - dayStartMs) / 60_000);
    return Math.max(0, Math.min(1440, m));
  };

  // 合并已记录区间 → 未记录缺口（>2 分钟）
  const gaps = useMemo(() => {
    const sorted = blocks
      .map((b) => ({ s: minOfDay(b.start_at), e: minOfDay(b.end_at) }))
      .sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number }[] = [];
    for (const seg of sorted) {
      const last = merged[merged.length - 1];
      if (last && seg.s <= last.e) last.e = Math.max(last.e, seg.e);
      else merged.push({ ...seg });
    }
    const out: { s: number; e: number }[] = [];
    let cursor = 0;
    for (const seg of merged) {
      if (seg.s - cursor > 2) out.push({ s: cursor, e: Math.min(seg.s, 1440) });
      cursor = Math.max(cursor, seg.e);
    }
    if (1440 - cursor > 2) out.push({ s: cursor, e: 1440 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, date]);

  /** 在绝对分钟处打开补录：定位该时刻所在整点区间（钳进缺口；贴边不足 5 分钟回退缺口末段一小时） */
  function openSlotAt(absMin: number) {
    const gap = gaps.find((g) => absMin >= g.s && absMin <= g.e);
    if (!gap) return;
    const hourStart = Math.floor(absMin / 60) * 60;
    let s = Math.max(gap.s, hourStart);
    let e = Math.min(gap.e, hourStart + 60);
    if (e - s < 5) {
      s = Math.max(gap.s, gap.e - 60);
      e = gap.e;
    }
    onOpenSlot(hmOf(s), hmOf(e));
  }

  /** tap 事件的视口 Y（changedTouches 在 touchend 阶段才有值） */
  function tapClientY(e: unknown): number | null {
    const ev = e as { changedTouches?: { clientY?: number }[]; detail?: { y?: number } };
    return ev?.changedTouches?.[0]?.clientY ?? ev?.detail?.y ?? null;
  }

  /** 点时间轴裸背景（左侧留白条等缺口按钮未覆盖处）→ 同样定位整点区间 */
  function containerTap(e: unknown) {
    const y = tapClientY(e);
    if (y == null) return;
    Taro.createSelectorQuery()
      .select("#tl-body")
      .boundingClientRect((rect: unknown) => {
        const r = rect as { top?: number } | null;
        if (!r || r.top == null) return;
        const units = y - r.top;
        openSlotAt(Math.max(0, Math.min(1439, units / unitPx() / PPM)));
      })
      .exec();
  }

  function gapTap(e: unknown, g: { s: number; e: number }, i: number) {
    const ev = e as { stopPropagation?: () => void };
    ev.stopPropagation?.(); // 不冒泡到容器，避免二次计算覆盖
    const y = tapClientY(e);
    if (y == null) return;
    Taro.createSelectorQuery()
      .select(`#tl-gap-${i}`)
      .boundingClientRect((rect: unknown) => {
        const r = rect as { top?: number } | null;
        if (!r || r.top == null) return;
        openSlotAt(g.s + (y - r.top) / unitPx() / PPM);
      })
      .exec();
  }

  // 每个日期只在数据到位后自动定位一次：今天→当前时刻；其他日期→第一块日程（无块回顶部）
  useEffect(() => {
    if (loading || lastAutoDate.current === date) return;
    lastAutoDate.current = date;
    let units = 0;
    if (isToday) {
      units = Math.max(0, bjNowMin() * PPM - AUTO_OFFSET);
    } else {
      const starts = blocks.map((b) => minOfDay(b.start_at));
      units = starts.length ? Math.max(0, Math.min(...starts) * PPM - AUTO_OFFSET) : 0;
    }
    setScrollTop(units * unitPx());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading, isToday, blocks]);

  return (
    <View>
      {/* = web: relative max-h-[480px] overflow-y-auto rounded-lg border（内滚容器） */}
      <ScrollView
        className="tl-scroll"
        scrollY
        enhanced
        showScrollbar={false}
        scrollTop={scrollTop}
        // 数据/切日自动定位时平移滚动；用户手滚不受影响
        scrollWithAnimation={false}
      >
        <View id="tl-body" className="tl-body" style={{ height: `${DAY_H}rpx` }} onTap={containerTap}>
          {Array.from({ length: 25 }, (_, h) => (
            <View key={h} className="tl-hour" style={{ top: `${h * 60 * PPM}rpx` }}>
              {h % 3 === 0 && <Text className={`tl-hour-label ${h % 3 === 0 ? "strong" : ""}`}>{`${h}点`}</Text>}
            </View>
          ))}

          {gaps.map((g, i) => {
            const span = g.e - g.s;
            return (
              <View
                key={`gap-${i}`}
                id={`tl-gap-${i}`}
                className="tl-gap"
                style={{ top: `${g.s * PPM}rpx`, height: `${Math.max(span * PPM - 4, 16)}rpx` }}
                onTap={(e) => gapTap(e, g, i)}
              >
                {span * PPM >= 44 && (
                  <Text className="tl-gap-label">
                    ✦ 未记录 {hmOf(g.s)}–{hmOf(g.e)}（
                    {span >= 60 ? `${Math.floor(span / 60)}小时${span % 60 || ""}` : `${span}分钟`}）
                  </Text>
                )}
              </View>
            );
          })}

          {blocks.map((b) => {
            const s = minOfDay(b.start_at);
            const e = Math.max(minOfDay(b.end_at), s + 2);
            const h = (e - s) * PPM; // 块高（设计单位）
            return (
              <View
                key={b.id}
                className="tl-block"
                style={{
                  top: `${s * PPM}rpx`,
                  height: `${h - 4}rpx`,
                  backgroundColor: `${b.color}40`, // hex 追加 alpha = web ${color}40
                  borderLeftColor: b.color,
                }}
                onTap={(ev) => {
                  (ev as { stopPropagation?: () => void }).stopPropagation?.();
                  onEditBlock(b);
                }}
              >
                {h >= 36 && (
                  <View className="tl-block-full">
                    <Text className="tl-block-icon">{b.icon}</Text>
                    <Text className="tl-block-title">{b.title}</Text>
                    <Text className="tl-block-time">
                      {hmOf(s)}–{hmOf(e)}
                    </Text>
                  </View>
                )}
                {h < 36 && h >= 18 && <Text className="tl-block-icon">{b.icon}</Text>}
              </View>
            );
          })}

          {isToday && nowMin != null && (
            <View className="tl-now" style={{ top: `${nowMin * PPM}rpx` }}>
              <Text className="tl-now-label">{hmOf(nowMin)}</Text>
            </View>
          )}
        </View>
      </ScrollView>
      <Text className="tl-hint">
        提示：点击彩色块可修改 · 点击空白处自动定位整点 1 小时补录（表单内可调时间）{isToday ? " · 红线为当前时刻" : ""}
      </Text>
    </View>
  );
}
