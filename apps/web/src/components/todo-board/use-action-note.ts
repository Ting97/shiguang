"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TodoRow } from "@/lib/types";
import { isoToLocalInput, localInputToIso } from "../todo-bits";
import type { Msg } from "./types";

/** useActionNote 上下文：patchTodo（保存）/ setMsg（空标题与取消提示） */
export interface ActionNoteCtx {
  patchTodo: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
  setMsg: (m: Msg) => void;
}

/**
 * 行动详情面板 hook（拆分自 todo-board，行为零变化）：
 * 点标题展开——标题 + 详细内容（≤1000 字）+ 截止 + 🔁 每日重复（与已完成次数只读展示）。
 * closeNote 复刻拆分前 Dismissable onClose 的「有改动轻提示」逻辑。
 */
export function useActionNote({ patchTodo, setMsg }: ActionNoteCtx) {
  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDue, setNoteDue] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  // 行动详情面板里的 🔁 每日重复开关（与已完成次数只读展示）
  const [noteRepeat, setNoteRepeat] = useState(false);
  const [noteDoneCount, setNoteDoneCount] = useState(0);

  /** 点开行动详情：标题 + 描述 + 截止 + 🔁 每日重复（列表里只展示标题） */
  function openNote(c: TodoRow) {
    setNoteOpenId(c.id);
    setNoteTitle(c.title);
    setNoteText(c.note ?? "");
    setNoteDue(isoToLocalInput(c.due_at));
    setNoteRepeat(c.repeat_daily);
    setNoteDoneCount(c.repeat_done_count);
  }

  /** N3：点空白/Esc 取消，有改动轻提示 */
  function closeNote(c: TodoRow) {
    const dirty =
      noteTitle !== c.title ||
      noteText !== (c.note ?? "") ||
      noteDue !== isoToLocalInput(c.due_at) ||
      noteRepeat !== c.repeat_daily;
    if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
    setNoteOpenId(null);
  }

  async function saveNote() {
    if (!noteOpenId || !noteTitle.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    setNoteSaving(true);
    try {
      const ok = await patchTodo(
        noteOpenId,
        {
          title: noteTitle.trim(),
          note: noteText.trim() ? noteText.trim() : null,
          dueAt: localInputToIso(noteDue),
          repeatDaily: noteRepeat,
        },
        "💾 行动已保存",
      );
      // 失败时不关闭面板，保留用户正在编辑的内容
      if (ok) setNoteOpenId(null);
    } catch {
      // 兜底：任何异常只提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      setMsg({ ok: false, text: "网络异常，请稍后重试" });
    } finally {
      setNoteSaving(false);
    }
  }

  return {
    noteOpenId,
    setNoteOpenId: setNoteOpenId as Dispatch<SetStateAction<string | null>>,
    noteTitle,
    setNoteTitle,
    noteText,
    setNoteText,
    noteDue,
    setNoteDue,
    noteSaving,
    noteRepeat,
    setNoteRepeat,
    noteDoneCount,
    openNote,
    closeNote,
    saveNote,
  };
}

export type ActionNote = ReturnType<typeof useActionNote>;
