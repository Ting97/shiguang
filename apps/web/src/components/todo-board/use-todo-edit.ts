"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TodoItem, TodoRow } from "@/lib/types";
import { isoToLocalInput, localInputToIso } from "../todo-bits";
import { isChildId } from "./kit";
import type { Msg } from "./types";

/** useTodoEdit 上下文：列表数据 + patchTodo（保存）/ setMsg（空标题与取消提示） */
export interface TodoEditCtx {
  todos: TodoItem[];
  patchTodo: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
  setMsg: (m: Msg) => void;
}

/**
 * 顶层 todo 行内编辑 hook（拆分自 todo-board，行为零变化）：
 * 标题 / 截止 / 分类 / 🔁 每日重复（重复仅行动提交，isChildId 判定）。
 * closeEdit 复刻拆分前 Dismissable onClose 的「有改动轻提示」逻辑。
 */
export function useTodoEdit({ todos, patchTodo, setMsg }: TodoEditCtx) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");
  // 行动行内编辑的 🔁 每日重复开关
  const [editRepeat, setEditRepeat] = useState(false);

  function startEdit(t: TodoRow) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(isoToLocalInput(t.due_at));
    setEditActivity(t.activity_id ?? "other");
    setEditRepeat(t.repeat_daily);
  }

  /** N3：点空白/Esc 取消，有改动轻提示 */
  function closeEdit(t: TodoRow) {
    const dirty = editTitle !== t.title || editDue !== isoToLocalInput(t.due_at) || editActivity !== (t.activity_id ?? "other");
    if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    const ok = await patchTodo(
      editingId,
      {
        title: editTitle.trim(),
        dueAt: localInputToIso(editDue),
        activityId: editActivity,
        ...(isChildId(editingId, todos) ? { repeatDaily: editRepeat } : {}),
      },
      "💾 已保存",
    );
    if (ok) setEditingId(null);
  }

  return {
    editingId,
    setEditingId: setEditingId as Dispatch<SetStateAction<string | null>>,
    editTitle,
    setEditTitle,
    editDue,
    setEditDue,
    editActivity,
    setEditActivity,
    editRepeat,
    setEditRepeat,
    startEdit,
    closeEdit,
    saveEdit,
  };
}

export type TodoEdit = ReturnType<typeof useTodoEdit>;
