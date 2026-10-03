"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TodoItem, TodoRow } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { confirmDialog } from "@/shared/ui/confirm";
import { localInputToIso } from "../todo-bits";
import { EMPTY_DRAFT } from "./kit";
import type { Draft, View } from "./types";

/** useTodoActions 上下文：入口的视图/列表数据 + 添加行草稿与行动输入行状态（props 传值，不引入新状态管理） */
export interface TodoActionsCtx {
  view: View;
  todos: TodoItem[];
  load: (v: View) => Promise<void>;
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
  const { view, todos, load, draft, setDraft, setDraftOpen, subTitle, setSubTitle } = ctx;
  const [adding, setAdding] = useState(false);
  // 添加行动进行中：防连按 Enter 重复建行动（历史 bug：双击 Enter 落两条重复行动）
  const [addingSub, setAddingSub] = useState(false);
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
      toast(`📌 已添加「${j.todo.title}」`);
      await load(view);
    } catch (e) {
      toast(`添加失败：${e instanceof Error ? e.message : e}`, "err");
    } finally {
      setAdding(false);
    }
  }

  async function patchTodo(id: string, body: Record<string, unknown>, okText?: string) {
    try {
      await api<any>(`/api/todos/${id}`, "PATCH", body);
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发 ChunkErrorReloader 整页刷新、丢失编辑状态）
      if (e instanceof ApiClientError) {
        toast(e.message, "err");
      } else {
        toast("网络异常，请稍后重试", "err");
      }
      return false;
    }
    if (okText) toast(okText);
    try {
      await load(view);
    } catch {
      // 刷新列表失败同样只提示，不外抛
      toast("网络异常，请稍后重试", "err");
    }
    return true;
  }

  async function toggleDone(t: TodoRow) {
    const done = t.status === "done";
    await patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️ 「${t.title}」已恢复` : `🎉 完成「${t.title}」`);
  }

  /** 未完成行动数（菜单据此给出「重新生成 / 追加」显式选择） */
  function pendingCount(t: TodoRow): number {
    const parent = todos.find((x) => x.id === t.id);
    return parent?.children.filter((c) => c.status === "pending").length ?? 0;
  }

  /** AI 拆解（REQ-001 R3 · 插入式）：待办→≤10 行动；行动→≤3 同级细化（插入其后）。
   *  mode 由菜单显式传入（原 window.confirm「确定=重生成/取消=追加」双语义不可发现且易误触） */
  async function decompose(t: TodoRow, isAction: boolean, mode?: "replace" | "append") {
    if (decomposingId) return;
    setDecomposingId(t.id);
    try {
      let j: any;
      try {
        j = await api<any>(`/api/todos/${t.id}/decompose`, "POST", mode ? { mode } : {});
      } catch (e) {
        // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
        toast(
          e instanceof ApiClientError ? (e.message === "操作失败" ? "AI 拆解失败" : e.message) : "网络异常，请稍后重试",
          "err",
        );
        return;
      }
      toast(`✨ AI 拆出 ${j.actions.length} 个行动${isAction ? "，已插入原行动之后" : ""}`);
      try {
        await load(view);
      } catch {
        // 刷新列表失败同样只提示，不外抛
        toast("网络异常，请稍后重试", "err");
      }
    } finally {
      setDecomposingId(null);
    }
  }

  async function removeTodo(t: TodoRow, isChild: boolean) {
    // 确认弹窗（9-B）：独立渲染树单次点击确认——规避 008 实测 portal 菜单内二次点击丢失问题
    const hint = isChild ? "" : "\n其下行动将一并删除。";
    const ok = await confirmDialog({
      title: `删除${isChild ? "行动" : "todo"}`,
      message: `「${t.title}」${hint}`,
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      await api<any>(`/api/todos/${t.id}`, "DELETE");
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      toast(
        e instanceof ApiClientError ? (e.message === "操作失败" ? "删除失败" : e.message) : "网络异常，请稍后重试",
        "err",
      );
      return;
    }
    toast(`🗑 已删除「${t.title}」`);
    try {
      await load(view);
    } catch {
      // 刷新列表失败同样只提示，不外抛
      toast("网络异常，请稍后重试", "err");
    }
  }

  async function addSubtask(parentId: string) {
    const title = subTitle.trim();
    if (!title || addingSub) return;
    setAddingSub(true);
    try {
      await api<any>("/api/todos", "POST", { title, parentId });
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      toast(
        e instanceof ApiClientError ? (e.message === "操作失败" ? "添加失败" : e.message) : "网络异常，请稍后重试",
        "err",
      );
      setAddingSub(false); // 失败也要复位，否则输入行永久锁死
      return;
    }
    setSubTitle("");
    try {
      await load(view);
    } catch {
      // 刷新列表失败同样只提示，不外抛
      toast("网络异常，请稍后重试", "err");
    } finally {
      setAddingSub(false);
    }
  }

  return { adding, addingSub, decomposingId, addTodo, patchTodo, toggleDone, decompose, removeTodo, addSubtask, pendingCount };
}
