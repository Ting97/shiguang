"use client";

import type { ReactNode, Ref } from "react";

/**
 * 全站统一 chip 范式（对齐 todo-board 视觉，001-R2）：
 * - TagChip：展示型标签，emoji 装入语义色 tinted chip —— 概念定色，一色到底
 * - IconDisc：无语义信息的 icon（DB 活动/账户 icon 等）包 tinted 圆底
 * - FilterChip：交互型筛选/切换 chip，激活态 = sky→indigo 渐变 + 白字 + 光晕
 * tone 映射与 globals.css 语义变量对齐，深浅主题自适应。
 */

export type Tone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";

const TONE_CHIP: Record<Tone, string> = {
  sky: "bg-sky-500/15 text-accent",
  emerald: "bg-emerald-500/15 text-success",
  amber: "bg-amber-500/20 text-warn",
  rose: "bg-rose-500/15 text-danger",
  violet: "bg-violet-500/15 text-ai",
  slate: "bg-elevated text-ink-mute",
};

const TONE_DISC: Record<Tone, string> = {
  sky: "bg-sky-500/15",
  emerald: "bg-emerald-500/15",
  amber: "bg-amber-500/20",
  rose: "bg-rose-500/15",
  violet: "bg-violet-500/15",
  slate: "bg-elevated",
};

/** tone → 底色类（给自定义容器的 tinted 背景，如联系人头像按分组色） */
export const TONE_BG = TONE_DISC;

/** 展示型标签：语义色 tinted 底 + 同色系文字，rounded-lg 小圆角 */
export function TagChip({
  icon,
  label,
  tone = "slate",
  size = "md",
  className = "",
  title,
}: {
  icon?: ReactNode;
  label: ReactNode;
  tone?: Tone;
  /** sm=卡片头小标签（10px）；md=常规（11px） */
  size?: "sm" | "md";
  className?: string;
  title?: string;
}) {
  const sizing = size === "sm" ? "gap-1 px-1.5 py-0.5 text-[10px]" : "gap-1 px-2 py-0.5 text-[11px]";
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center rounded-lg font-medium ${sizing} ${TONE_CHIP[tone]} ${className}`}
    >
      {icon && <span className="shrink-0 text-[12px] leading-none">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

/** icon 圆底：给裸排 emoji 图标一个语义色容器（默认 sky） */
export function IconDisc({
  children,
  tone = "sky",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none ${TONE_DISC[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * 交互型筛选/切换 chip：
 * - variant="board"（默认）：todo-board 智能列表式，rounded-xl px-3.5 py-2，支持 vertical（PC 侧栏 w-full justify-between）与计数徽标
 * - variant="pill"：胶囊容器内切换式（schedule 三 tab / 列表·图谱 / 时间轴·列表），rounded-full 小尺寸
 * - variant="filter"：横滑多选筛选式（contacts 分组），未激活带边框底色
 */
export function FilterChip({
  label,
  icon,
  count,
  active,
  onClick,
  variant = "board",
  vertical = false,
  title,
  chipRef,
  className = "",
}: {
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  active: boolean;
  onClick?: () => void;
  variant?: "board" | "pill" | "filter";
  vertical?: boolean;
  title?: string;
  chipRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const size =
    variant === "board"
      ? `gap-2 rounded-xl px-3.5 py-2 text-[13px] ${vertical ? "w-full justify-between" : ""}`
      : variant === "pill"
        ? "gap-1.5 rounded-full px-3.5 py-1.5 text-xs"
        : "gap-1 rounded-full px-3 py-1 text-xs";
  const state = active
    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
    : variant === "filter"
      ? "border border-line-soft bg-surface/60 text-ink-mute hover:bg-wash hover:text-ink"
      : "text-ink-mute hover:bg-wash hover:text-ink";
  return (
    <button
      ref={chipRef}
      onClick={onClick}
      title={title}
      className={`flex shrink-0 items-center whitespace-nowrap transition-all duration-200 ${size} ${state} ${className}`}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={`min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums ${
            active ? "bg-white/25 text-white" : "bg-elevated text-ink-dim"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
