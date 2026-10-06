"use client";

/** 空间详情的行操作菜单入口：统一走 components/todo 共享菜单（REQ-009 滚动），
 * 菜单项与日程 todo-board 完全一致（此前缺 每日重复/⭐重要/☀️标记今日，现补齐）。 */
import { TodoRowMenu } from "@/components/todo";
import type { MenuRowState, Pos } from "./types";
import type { TodoActions } from "./use-todo-actions";

export default function RowMenuModal(opts: {
  menuRow: MenuRowState;
  pos: Pos | null;
  actions: TodoActions;
}) {
  const { menuRow, pos, actions } = opts;
  const { busyId, setMenuRow, openNote, decompose, removeTodo, startEdit, setPickerRow, pendingCount, addAction } = actions;
  const row = menuRow.todo;
  return (
    <TodoRowMenu
      info={{ todo: row, isChild: menuRow.isChild, parentTitle: (row as { parent_title?: string | null }).parent_title ?? null }}
      menuPos={pos}
      onClose={() => setMenuRow(null)}
      actions={{
        decomposingId: busyId,
        patch: patchTodo,
        decompose: (_t, isAction, mode) => decompose({ id: row.id, title: row.title, isAction }, mode),
        remove: (_t) => removeTodo(row.id, row.title),
        pendingCount: () => pendingCount(row),
        startEdit: () => startEdit(row),
        openNote: () => openNote(row),
        pickSpace: () => setPickerRow({ id: row.id, spaceId: (row as { space_id?: string | null }).space_id ?? null }),
        addAction: (t) => addAction(t),
      }}
    />
  );
}
