"use client";

import type { TodoRow } from "@/lib/types";
import { isoToBjInput, bjInputToIso } from "@/lib/bj-time";

/** 待办共用小件：勾选圆圈 + 时间标签 + 日期工具（todo-board / actions-today 共用） */

export const pad = (n: number) => String(n).padStart(2, "0");

/** 北京日历日序号（UTC+8 推算，禁本地 getter：海外设备的日界会错 8 小时） */
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

export const zhTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** due 标签：已过期红 / 今天 / 明天 / N 天后 / 无时间 */
export const dueTag = (iso: string | null) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (t < Date.now()) return { text: "已过期", cls: "text-danger" };
  const days = bjDayIdx(t) - bjDayIdx(Date.now());
  if (days === 0) return { text: "今天", cls: "text-warn" };
  if (days === 1) return { text: "明天", cls: "text-accent" };
  return { text: `${days} 天后`, cls: "text-ink-mute" };
};

// 北京墙上时间口径（lib/bj-time 单源）：本地 getter 版在海外设备上编辑框与列表展示错位
export const isoToLocalInput = (iso: string | null) => (iso ? isoToBjInput(iso) : "");

export const localInputToIso = (v: string) => bjInputToIso(v);

/** 微软 To Do 式勾选圆圈：未完成空心圈（悬停变蓝），完成实心蓝底白勾 */
export function TodoCircle({
  done,
  onClick,
  size = "md",
  disabled = false,
}: {
  done: boolean;
  onClick: () => void;
  size?: "md" | "sm";
  /** 提交进行中禁用（防连点重复打卡），可选 */
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={done ? "点击恢复为未完成" : "点击标记完成"}
      aria-label={done ? "恢复为未完成" : "标记完成"}
      className={`tap-lg flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
        size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs"
      } ${
        done
          ? "border-sky-500 bg-sky-500 text-white shadow-sm shadow-sky-500/40"
          : "border-slate-500 text-transparent hover:border-sky-400 hover:text-accent/60"
      }`}
    >
      ✓
    </button>
  );
}

/** 子任务进度：已完成 n / 共 m（无子任务返回 null） */
export function childProgress(children: TodoRow[]): { n: number; m: number } | null {
  if (children.length === 0) return null;
  return { n: children.filter((c) => c.status === "done").length, m: children.length };
}
