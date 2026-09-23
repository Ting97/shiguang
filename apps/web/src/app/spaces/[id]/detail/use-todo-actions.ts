"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TodoItem, TodoRow } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { isoToLocalInput, localInputToIso } from "@/components/todo-bits";
import type { MenuRowState, Msg, Pos } from "./types";

/**
 * 关联 TODO·行动的行级状态与提交（自 detail.tsx 拆出）：
 * 添加/勾选/删除、✨AI 拆解、行内编辑（与日程 todo-board 同交互）、
 * 行动详情面板、手动添加行动、「关联已有」浮层、行级空间关联、行操作菜单卡片。
 */
export function useTodoActions(opts: {
  id: string;
  /** 未完成关联 todo（decompose 追加/重生成判断用） */
  todos: TodoItem[];
  load: () => Promise<void>;
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { id, todos, load, setMsg } = opts;
  const [newTodo, setNewTodo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  // 行动描述编辑（复用 note 字段；详情页只读展开）
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  // 行操作菜单卡片（点「⋯」弹出；桌面锚定浮层 / 移动端底部弹层）
  const [menuRow, setMenuRow] = useState<MenuRowState | null>(null);
  const [menuPos, setMenuPos] = useState<Pos | null>(null);
  // 行内编辑器（与日程 todo-board 同交互）：顶层 todo 标题/截止/分类
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editActivity, setEditActivity] = useState("other");
  // 行动详情面板（点行动标题展开编辑）：标题+描述+截止+每日重复（取代原只读描述展开）
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDue, setNoteDue] = useState("");
  const [noteRepeat, setNoteRepeat] = useState(false);
  const [noteDoneCount, setNoteDoneCount] = useState(0);
  // 「关联已有」浮层：浏览未关联空间的顶层 TODO/独立行动并关联到本空间
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<TodoItem[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [_linkLoading, setLinkLoading] = useState(false);
  // C1：手动添加行动（per-todo 草稿）
  const [actionDrafts, setActionDrafts] = useState<Record<string, string>>({});
  // N1：行级空间关联浮层（待办行）
  const [pickerRow, setPickerRow] = useState<{ id: string; spaceId: string | null } | null>(null);
  // 添加提交防抖：busy 期间忽略重复提交（连按两次回车会 POST 两条）
  const [addingTodo, setAddingTodo] = useState(false);
  const [addingAction, setAddingAction] = useState(false);

  async function addTodo() {
    const t = newTodo.trim();
    if (!t || addingTodo) return;
    setAddingTodo(true);
    try {
      await api<any>("/api/todos", "POST", { title: t, spaceId: id });
    } catch (e) {
      // 失败要报错（含网络错误就地消化，避免 unhandled rejection 触发整页刷新）
      setMsg({ ok: false, text: e instanceof ApiClientError && e.message !== "操作失败" ? e.message : "添加失败" });
      return;
    } finally {
      setAddingTodo(false);
    }
    setNewTodo("");
    await load();
  }

  async function patchTodo(todoId: string, body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusyId(todoId);
    try {
      await api<any>(`/api/todos/${todoId}`, "PATCH", body);
      setMsg({ ok: true, text: okText });
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message });
        return false;
      }
      throw e;
    } finally {
      setBusyId(null);
    }
  }

  async function removeTodo(todoId: string, title: string) {
    if (!window.confirm(`删除「${title}」？\n其下行动会一并删除。`)) return;
    try {
      await api<any>(`/api/todos/${todoId}`, "DELETE");
    } catch (e) {
      // 失败报错并中止，不提示成功（历史 bug：吞掉 ApiClientError 后无条件提示「已删除」）
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return;
    }
    setMsg({ ok: true, text: "已删除" });
    await load();
  }

  /** AI 拆解：待办→≤10 行动（已有未完成时询问追加/重生成）；行动→≤3 同级细化（插入其后） */
  async function decompose(t: { id: string; title: string; isAction: boolean }) {
    const key = t.id;
    setBusyId(key);
    try {
      const askMode = !t.isAction;
      let mode: string | undefined;
      if (askMode) {
        const parent = todos.find((x) => x.id === t.id);
        const pending = parent?.children.filter((c) => c.status === "pending").length ?? 0;
        if (pending > 0) {
          const yes = window.confirm(`「${t.title}」已有 ${pending} 个未完成行动。\n\n确定 = 重新生成（清空未完成，已完成保留）\n取消 = 改为追加到末尾\n\n（追加请点取消后在弹窗选择）`);
          mode = yes ? "replace" : "append";
          if (!yes) {
            // append 需要再次确认语义
            mode = "append";
          }
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
      setMsg({ ok: true, text: `✨ AI 拆出 ${j.actions.length} 个行动${t.isAction ? "，已插入原行动之后" : ""}` });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  /** 行内编辑（与日程 todo-board 同交互）：顶层 todo 标题/截止/分类 */
  function startEdit(t: TodoRow) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDue(isoToLocalInput(t.due_at));
    setEditActivity(t.activity_id ?? "other");
  }

  async function saveEdit(): Promise<boolean> {
    if (!editingId || !editTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return false;
    }
    const ok = await patchTodo(editingId, {
      title: editTitle.trim(),
      dueAt: localInputToIso(editDue),
      activityId: editActivity,
    }, "💾 已保存");
    if (ok) setEditingId(null);
    return ok;
  }

  /** 行动详情面板：标题+描述+截止+每日重复（与 todo-board 行动面板同交互） */
  function openNote(c: TodoRow) {
    setNoteOpen(c.id);
    setNoteTitle(c.title);
    setNoteText(c.note ?? "");
    setNoteDue(isoToLocalInput(c.due_at));
    setNoteRepeat(c.repeat_daily);
    setNoteDoneCount(c.repeat_done_count);
  }

  async function saveNote(): Promise<boolean> {
    if (!noteOpen || !noteTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return false;
    }
    const ok = await patchTodo(noteOpen, {
      title: noteTitle.trim(),
      note: noteText.trim() ? noteText.trim() : null,
      dueAt: localInputToIso(noteDue),
      repeatDaily: noteRepeat,
    }, "💾 行动已保存");
    if (ok) setNoteOpen(null);
    return ok;
  }

  /** 打开「关联已有」浮层：拉取未关联空间且未完成的顶层 TODO/独立行动（有父行动随父走，不在顶层） */
  async function openLinkPicker() {
    setLinkLoading(true);
    try {
      const j = await api<any>("/api/todos?view=all", "GET");
      setLinkItems(((j.todos as TodoItem[]) ?? []).filter((t) => !t.space_id && t.status === "pending"));
      setLinkQuery("");
      setLinkOpen(true);
    } catch {
      setMsg({ ok: false, text: "加载失败，请稍后再试" });
    } finally {
      setLinkLoading(false);
    }
  }

  /** 浮层内关联一条到本空间（成功后从浮层移除，可连续关联多条） */
  async function linkExisting(todoId: string) {
    const ok = await patchTodo(todoId, { spaceId: id }, "🎯 已关联到本空间");
    if (ok) setLinkItems((list) => list.filter((x) => x.id !== todoId));
  }

  /** C1：手动添加行动（回车保存；行动经 parentId 继承空间归属） */
  async function addAction(t: { id: string }) {
    const title = (actionDrafts[t.id] ?? "").trim();
    if (!title || addingAction) return;
    setAddingAction(true);
    try {
      await api<any>("/api/todos", "POST", { title, parentId: t.id });
    } catch (e) {
      // 失败要报错（含网络错误就地消化，避免 unhandled rejection 触发整页刷新）
      setMsg({ ok: false, text: e instanceof ApiClientError && e.message !== "操作失败" ? e.message : "添加失败" });
      return;
    } finally {
      setAddingAction(false);
    }
    setActionDrafts((d) => ({ ...d, [t.id]: "" }));
    setMsg({ ok: true, text: "📌 行动已添加" });
    await load();
  }

  /** N1：行级关联/切换/移除空间 */
  async function pickSpace(todoId: string, target: string | null) {
    setPickerRow(null);
    try {
      await api<any>(`/api/todos/${todoId}`, "PATCH", { spaceId: target });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "关联失败" : e.message });
        return;
      }
      throw e;
    }
    setMsg({ ok: true, text: target ? "🎯 已关联空间" : "已移除空间归属" });
    await load();
  }

  return {
    // 添加 todo
    newTodo, setNewTodo, addTodo,
    // 列表展开与行内编辑
    expanded, setExpanded, busyId,
    editingId, setEditingId, editTitle, setEditTitle, editDue, setEditDue, editActivity, setEditActivity,
    startEdit, saveEdit,
    // 行动详情面板
    noteOpen, setNoteOpen, noteTitle, setNoteTitle, noteText, setNoteText, noteDue, setNoteDue,
    noteRepeat, setNoteRepeat, noteDoneCount, openNote, saveNote,
    // 行操作菜单卡片
    menuRow, setMenuRow, menuPos, setMenuPos,
    // 行动草稿
    actionDrafts, setActionDrafts, addAction,
    // 关联已有浮层
    linkOpen, setLinkOpen, linkItems, linkQuery, setLinkQuery, openLinkPicker, linkExisting,
    // 行级空间关联
    pickerRow, setPickerRow, pickSpace,
    // 通用提交
    patchTodo, removeTodo, decompose,
  };
}

export type TodoActions = ReturnType<typeof useTodoActions>;
