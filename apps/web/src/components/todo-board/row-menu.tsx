"use client";

/** 日程 todo-board 的行操作菜单入口：统一走 components/todo 共享菜单（REQ-009 滚动）。
 * 本文件只做 TodoRow(MenuRowInfo) → 归一化 target 的适配，菜单项维护在共享模块。 */
import { TodoRowMenu, type TodoMenuActions } from "@/components/todo";
import type { TodoRow } from "@/lib/types";
import type { MenuRowInfo } from "./types";

export interface RowMenuActions {
  decomposingId: string | null;
  patchTodo: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
  decompose: (t: TodoRow, isAction: boolean, mode?: "replace" | "append") => Promise<void>;
  removeTodo: (t: TodoRow, isChild: boolean) => Promise<void>;
  pendingCount: (t: TodoRow) => number;
}

export function RowMenu({
  menuRow,
  menuPos,
  onClose,
  decomposingId,
  patchTodo,
  decompose,
  removeTodo,
  pendingCount,
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
  const row = menuRow.todo;
  // 回调绑定原始行对象（共享菜单只传归一化 {id,title}，避免结构断言）
  const actions: TodoMenuActions = {
    decomposingId,
    patch: patchTodo,
    decompose: (_t, isAction, mode) => decompose(row, isAction, mode),
    remove: (_t, isChild) => removeTodo(row, isChild),
    pendingCount: () => pendingCount(row),
    startEdit: () => startEdit(row),
    openNote: () => openNote(row),
    pickSpace: () => onPickSpace(row),
    addAction: () => onAddAction(row),
  };
  return (
    <TodoRowMenu
      info={{ todo: row, isChild: menuRow.isChild, parentTitle: menuRow.parentTitle }}
      menuPos={menuPos}
      onClose={onClose}
      actions={actions}
    />
  );
}
