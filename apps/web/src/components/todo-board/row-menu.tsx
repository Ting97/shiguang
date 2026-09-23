"use client";

import { createPortal } from "react-dom";
import type { TodoRow } from "@/lib/types";
import { Dismissable } from "../dismissable";
import { isDoneRow } from "./kit";
import type { MenuRowInfo } from "./types";

/** 菜单依赖的提交类回调（useTodoActions 提供，入口经 props 传入） */
export interface RowMenuActions {
  decomposingId: string | null;
  patchTodo: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
  decompose: (t: TodoRow, isAction: boolean) => Promise<void>;
  removeTodo: (t: TodoRow, isChild: boolean) => Promise<void>;
}

/** 菜单卡片单项：点击即关菜单再执行动作（danger 红、active 已开启徽标、busy 转圈文案） */
function MenuItem({ closeMenu, icon, label, hint, extra, danger, active, disabled, busy, onClick }: {
  closeMenu: () => void;
  icon: string;
  label: string;
  hint?: string;
  extra?: string;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (disabled) return;
        closeMenu();
        onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition disabled:opacity-40 ${
        danger ? "text-danger hover:bg-rose-500/10" : active ? "text-warn hover:bg-wash" : "text-ink hover:bg-wash"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-sm leading-none">{busy ? "⏳" : icon}</span>
      <span className="min-w-0 flex-1">
        {label}
        {hint && <span className="block truncate text-[10px] text-ink-faint">{hint}</span>}
      </span>
      {extra && <span className="shrink-0 text-[10px] tabular-nums text-success">{extra}</span>}
      {active && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-warn">已开启</span>}
    </button>
  );
}

/** 行操作菜单卡片：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层），portal 到 body */
export function RowMenu({
  menuRow,
  menuPos,
  onClose,
  decomposingId,
  patchTodo,
  decompose,
  removeTodo,
  startEdit,
  openNote,
  onPickSpace,
  onAddAction,
}: {
  menuRow: MenuRowInfo;
  menuPos: { top: number; left: number } | null;
  onClose: () => void;
  startEdit: (t: TodoRow) => void;
  openNote: (t: TodoRow) => void;
  onPickSpace: (t: TodoRow) => void;
  onAddAction: (t: TodoRow) => void;
} & RowMenuActions) {
  return createPortal(
    <Dismissable
      onClose={onClose}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
      style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
    >
      {/* 移动端拖拽指示条 */}
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
      <p className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-dim">{menuRow.todo.title}</span>
        {menuRow.isChild && menuRow.parentTitle && (
          <span className="max-w-24 shrink-0 truncate text-[10px] text-ink-faint">{menuRow.parentTitle}</span>
        )}
      </p>
      <div className="space-y-0.5">
        {menuRow.isChild ? (
          <>
            <MenuItem closeMenu={onClose} icon="✏️" label="编辑标题 / 描述" onClick={() => openNote(menuRow.todo)} />
            {!isDoneRow(menuRow.todo) && (
              <MenuItem
                closeMenu={onClose}
                icon="🔁"
                label={menuRow.todo.repeat_daily ? "关闭每日重复" : "每日重复（次日 6 点恢复）"}
                active={menuRow.todo.repeat_daily}
                extra={menuRow.todo.repeat_done_count > 0 ? `已完成 ×${menuRow.todo.repeat_done_count}` : undefined}
                onClick={() => patchTodo(menuRow.todo.id, { repeatDaily: !menuRow.todo.repeat_daily }, menuRow.todo.repeat_daily ? "已关闭每日重复" : "🔁 已设为每日重复")}
              />
            )}
            {!isDoneRow(menuRow.todo) && (
              <MenuItem
                closeMenu={onClose}
                icon="✨"
                label="AI 细化为更小行动"
                hint="插入到该行动之后"
                disabled={decomposingId === menuRow.todo.id}
                busy={decomposingId === menuRow.todo.id}
                onClick={() => decompose(menuRow.todo, true)}
              />
            )}
            <MenuItem closeMenu={onClose} icon="🗑" label="删除行动" danger onClick={() => removeTodo(menuRow.todo, true)} />
          </>
        ) : (
          <>
            <MenuItem closeMenu={onClose} icon="✏️" label="编辑标题与时间" onClick={() => startEdit(menuRow.todo)} />
            {!isDoneRow(menuRow.todo) && (
              <MenuItem
                closeMenu={onClose}
                icon="⭐"
                label={menuRow.todo.is_important ? "取消重要标记" : "标记为重要"}
                active={menuRow.todo.is_important}
                onClick={() => patchTodo(menuRow.todo.id, { important: !menuRow.todo.is_important }, menuRow.todo.is_important ? "已取消重要" : "⭐ 已标记为重要")}
              />
            )}
            {!isDoneRow(menuRow.todo) && (
              <MenuItem
                closeMenu={onClose}
                icon="☀️"
                label={menuRow.todo.today_tag_date ? "移出今日" : "标记为今日"}
                hint="今日标记跨零点自动失效"
                active={!!menuRow.todo.today_tag_date}
                onClick={() => patchTodo(menuRow.todo.id, { today: !menuRow.todo.today_tag_date }, menuRow.todo.today_tag_date ? "已移出今日" : "☀️ 已加入今日")}
              />
            )}
            <MenuItem
              closeMenu={onClose}
              icon="🎯"
              label="关联空间"
              onClick={() => onPickSpace(menuRow.todo)}
            />
            {!isDoneRow(menuRow.todo) && menuRow.todo.kind === "todo" && (
              <MenuItem
                closeMenu={onClose}
                icon="＋"
                label="添加行动"
                onClick={() => onAddAction(menuRow.todo)}
              />
            )}
            {!isDoneRow(menuRow.todo) && (
              <MenuItem
                closeMenu={onClose}
                icon="✨"
                label="AI 拆解为可执行的行动"
                disabled={decomposingId === menuRow.todo.id}
                busy={decomposingId === menuRow.todo.id}
                onClick={() => decompose(menuRow.todo, false)}
              />
            )}
            {isDoneRow(menuRow.todo) && (
              <MenuItem closeMenu={onClose} icon="↩️" label="恢复为未完成" onClick={() => patchTodo(menuRow.todo.id, { undone: true }, `↩️ 「${menuRow.todo.title}」已恢复`)} />
            )}
            <MenuItem closeMenu={onClose} icon="🗑" label="删除 todo" hint="其下行动一并删除" danger onClick={() => removeTodo(menuRow.todo, false)} />
          </>
        )}
      </div>
    </Dismissable>,
    document.body,
  );
}
