"use client";

/**
 * TODO/行动行操作菜单的统一构件（REQ-009 滚动：所有入口点击出来的菜单都一样）。
 * TodoRowMenu 是唯一权威菜单：日程 todo-board、空间详情、今日行动等入口共用；
 * 各入口经适配器传入 handlers，缺失的 handler 对应菜单项自动隐藏。
 */

export interface TodoMenuTarget {
  id: string;
  title: string;
  status: string;
  /** todo=父待办（可拆解/添加行动）；action=行动。缺省按非 action 处理 */
  kind?: string | null;
  repeat_daily?: boolean | null;
  repeat_done_count?: number | null;
  is_important?: boolean | null;
  today_tag_date?: string | null;
}

export interface TodoMenuInfo {
  todo: TodoMenuTarget;
  /** 行动（子条目）或独立行动：true 时菜单为行动分支 */
  isChild: boolean;
  parentTitle?: string | null;
}

/** 菜单依赖的提交类回调；可选 handler 缺席时对应菜单项隐藏（能力对齐由入口负责） */
export interface TodoMenuActions {
  /** AI 拆解/细化进行中的条目 id */
  decomposingId?: string | null;
  patch?: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean> | boolean;
  decompose?: (t: { id: string; title: string }, isAction: boolean, mode?: "replace" | "append") => unknown;
  remove?: (t: { id: string; title: string }, isChild: boolean) => unknown;
  /** 未完成行动数（>0 时拆解项展开为 重新生成/追加 二选一）；缺席=按 0 处理 */
  pendingCount?: (t: TodoMenuTarget) => number;
  /** 编辑标题与时间（父 todo） */
  startEdit?: (t: TodoMenuTarget) => void;
  /** 编辑标题/描述（行动）——详情面板 */
  openNote?: (t: TodoMenuTarget) => void;
  /** 关联空间 */
  pickSpace?: (t: TodoMenuTarget) => void;
  /** ＋添加行动 */
  addAction?: (t: TodoMenuTarget) => void;
}

/** 菜单单项：点击即关菜单再执行动作（danger 红、active 已开启徽标、busy 转圈、twoStep 两步确认） */
export function MenuItem({ closeMenu, icon, label, hint, extra, danger, active, disabled, busy, armed, twoStep, onClick }: {
  closeMenu: () => void;
  icon: string;
  label: string;
  hint?: string;
  extra?: string;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** 两步确认待确认态：高亮且不再关闭菜单 */
  armed?: boolean;
  /** 两步确认菜单项：首点（进入待确认态）不关菜单，执行动作时由 onClick 自行关闭 */
  twoStep?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (disabled) return;
        if (!twoStep) closeMenu();
        onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition disabled:opacity-40 ${
        armed
          ? "bg-rose-500/10 font-medium text-danger"
          : danger
            ? "text-danger hover:bg-rose-500/10"
            : active
              ? "text-warn hover:bg-wash"
              : "text-ink hover:bg-wash"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-sm leading-none">{busy ? "⏳" : icon}</span>
      <span className="min-w-0 flex-1">
        {label}
        {hint && <span className="block truncate text-badge text-ink-faint">{hint}</span>}
      </span>
      {extra && <span className="shrink-0 text-badge tabular-nums text-success">{extra}</span>}
      {active && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-badge text-warn">已开启</span>}
    </button>
  );
}
