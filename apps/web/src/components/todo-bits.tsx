"use client";

import type { TodoRow } from "@/lib/types";

/** 待办共用小件：勾选圆圈 + 时间标签 + 日期工具（todo-board / today-todos 共用） */

export const pad = (n: number) => String(n).padStart(2, "0");

export const zhTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** due 标签：已过期红 / 今天 / 明天 / N 天后 / 无时间 */
export const dueTag = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (d < new Date()) return { text: "已过期", cls: "text-danger" };
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(d) - dayStart(new Date())) / 86400_000);
  if (days === 0) return { text: "今天", cls: "text-warn" };
  if (days === 1) return { text: "明天", cls: "text-accent" };
  return { text: `${days} 天后`, cls: "text-ink-mute" };
};

export const isoToLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const localInputToIso = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/** 微软 To Do 式勾选圆圈：未完成空心圈（悬停变蓝），完成实心蓝底白勾 */
export function TodoCircle({
  done,
  onClick,
  size = "md",
}: {
  done: boolean;
  onClick: () => void;
  size?: "md" | "sm";
}) {
  return (
    <button
      onClick={onClick}
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
