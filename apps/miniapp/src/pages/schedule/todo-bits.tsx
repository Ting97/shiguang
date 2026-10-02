/**
 * 待办共用小件（= web todo-bits.tsx）：勾选圆圈 + due 标签 + 子任务进度。
 * dueTag 返回语义键（over/today/future/days），配色由 scss 类给出（web 是 tailwind 类）。
 */
import { Text, View } from "@tarojs/components";
import type { TodoRow } from "./api";
import { bjInputToIso, isoToBjInput } from "./date";
/** 北京日历日序号（UTC+8 推算，禁本地 getter：海外设备的日界会错 8 小时） */
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

export interface DueTag {
  text: string;
  tone: "over" | "today" | "tmrw" | "days";
}

/** due 标签：已过期红 / 今天 / 明天 / N 天后 / 无（null） */
export function dueTag(iso: string | null): DueTag | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (t < Date.now()) return { text: "已过期", tone: "over" };
  const days = bjDayIdx(t) - bjDayIdx(Date.now());
  if (days === 0) return { text: "今天", tone: "today" };
  if (days === 1) return { text: "明天", tone: "tmrw" };
  return { text: `${days} 天后`, tone: "days" };
}

/** 微软 To Do 式勾选圆圈：未完成空心圈，完成实心蓝底白勾（两步完成的第一步入口在行菜单） */
export function TodoCircle({
  done,
  onTap,
  size = "md",
}: {
  done: boolean;
  onTap: () => void;
  size?: "md" | "sm";
}) {
  return (
    <View
      className={`todo-circle ${size === "sm" ? "sm" : ""} ${done ? "done" : ""}`}
      hoverClass="press"
      hoverStayTime={80}
      onTap={onTap}
    >
      <Text>✓</Text>
    </View>
  );
}

/** 子任务进度：已完成 n / 共 m（无子任务返回 null） */
export function childProgress(children: TodoRow[]): { n: number; m: number } | null {
  if (children.length === 0) return null;
  return { n: children.filter((c) => c.status === "done").length, m: children.length };
}

/** 独立行动徽标（kind=action 且不属于任何 todo 时展示） */
export function ActionBadge() {
  return <Text className="todo-action-badge">行动</Text>;
}

/** 截止时间拆/装（北京墙上时间 "YYYY-MM-DDTHH:mm" ↔ date/time 双 picker 值） */
export function splitDue(iso: string | null): { date: string; time: string } {
  const v = isoToBjInput(iso);
  if (!v) return { date: "", time: "" };
  const [d, tm] = v.split("T");
  return { date: d, time: tm };
}

/** 只选日期未选时间时默认 09:00（web datetime-local 必带时刻）；空日期 → null（清截止） */
export function joinDue(date: string, time: string): string | null {
  if (!date) return null;
  return bjInputToIso(`${date}T${time || "09:00"}`);
}
