"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TodoItem, TodoRow } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { localInputToIso } from "../todo-bits";
import { EMPTY_DRAFT } from "./kit";
import type { Draft, Msg, View } from "./types";

/** useTodoActions 上下文：入口的视图/列表数据 + 添加行草稿与行动输入行状态（props 传值，不引入新状态管理） */
export interface TodoActionsCtx {
  view: View;
  todos: TodoItem[];
  load: (v: View) => Promise<void>;
  setMsg: (m: Msg) => void;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  setDraftOpen: (open: boolean) => void;
  subTitle: string;
  setSubTitle: (t: string) => void;
}

/**
 * 提交类操作 hook（拆分自 todo-board，行为零变化）：
 * 添加 / PATCH / 完成·恢复 / ✨AI 拆解 / 删除 / 添加行动。
 * 错误分支、提示文案、成功后 reload 与拆分前逐行一致。
 */
export function useTodoActions(ctx: TodoActionsCtx) {
  const { view, todos, load, setMsg, draft, setDraft, setDraftOpen, subTitle, setSubTitle } = ctx;
  const [adding, setAdding] = useState(false);
  // AI 拆解进行中的节点 id
  const [decomposingId, setDecomposingId] = useState<string | null>(null);

  async function addTodo() {
    const title = draft.title.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const j = await api<any>("/api/todos", "POST", {
        title,
        activityId: draft.activityId || undefined,
        important: draft.important || view === "important" ? true : undefined,
        today: draft.today || view === "today" ? true : undefined,
        dueAt: draft.due ? localInputToIso(draft.due) : undefined,
        spaceId: draft.spaceId || undefined,
      });
      setDraft({ ...EMPTY_DRAFT, activityId: draft.activityId });
      setDraftOpen(false);
      setMsg({ ok: true, text: `📌 已添加「${j.todo.title}」` });
      await load(view);
    } catch (e) {
      setMsg({ ok: false, text: `添加失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setAdding(false);
    }
  }

  async function patchTodo(id: string, body: Record<string, unknown>, okText?: string) {
    try {
      await api<any>(`/api/todos/${id}`, "PATCH", body);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message });
        return false;
      }
      throw e;
    }
    if (okText) setMsg({ ok: true, text: okText });
    await load(view);
    return true;
  }

  async function toggleDone(t: TodoRow) {
    const done = t.status === "done";
    await patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️ 「${t.title}」已恢复` : `🎉 完成「${t.title}」`);
  }

  /** AI 拆解（REQ-001 R3 · 插入式）：待办→≤10 行动（追加尾部/重新生成）；行动→≤3 同级细化（插入其后） */
  async function decompose(t: TodoRow, isAction: boolean) {
    if (decomposingId) return;
    setDecomposingId(t.id);
    try {
      let mode: string | undefined;
      if (!isAction) {
        const parent = todos.find((x) => x.id === t.id);
        const pending = parent?.children.filter((c) => c.status === "pending").length ?? 0;
        if (pending > 0) {
          mode = window.confirm(`「${t.title}」已有 ${pending} 个未完成行动。\n\n「确定」= 重新生成（清空未完成，已完成与次数保留）\n「取消」= 追加到末尾`)
            ? "replace"
            : "append";
        }
      }
      let j: any;
      try {
        j = await api<any>(`/api/todos/${t.id}/decompose`, "POST", mode ? { mode } : {});
      } catch (e) {
        if (e instanceof ApiClientError) {
          setMsg({ ok: false, text: e.message === "操作失败" ? "AI 拆解失败" : e.message });
          return;
        }
        throw e;
      }
      setMsg({ ok: true, text: `✨ AI 拆出 ${j.actions.length} 个行动${isAction ? "，已插入原行动之后" : ""}` });
      await load(view);
    } finally {
      setDecomposingId(null);
    }
  }

  async function removeTodo(t: TodoRow, isChild: boolean) {
    if (!window.confirm(`删除${isChild ? "行动" : "todo"}？${isChild ? "" : "\n其下行动将一并删除。"}\n「${t.title}」`)) return;
    try {
      await api<any>(`/api/todos/${t.id}`, "DELETE");
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "删除失败" : e.message });
        return;
      }
      throw e;
    }
    setMsg({ ok: true, text: `🗑 已删除「${t.title}」` });
    await load(view);
  }

  async function addSubtask(parentId: string) {
    const title = subTitle.trim();
    if (!title) return;
    try {
      await api<any>("/api/todos", "POST", { title, parentId });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "添加失败" : e.message });
        return;
      }
      throw e;
    }
    setSubTitle("");
    await load(view);
  }

  return { adding, decomposingId, addTodo, patchTodo, toggleDone, decompose, removeTodo, addSubtask };
}
