"use client";

import type { Dispatch, SetStateAction } from "react";
import { Dismissable } from "@/components/dismissable";
import { isoToLocalInput } from "@/components/todo-bits";
import type { TodoRow } from "@/lib/types";
import type { Msg } from "./types";
import type { TodoActions } from "./use-todo-actions";

/** 行动详情面板（自 detail.tsx 拆出；可编辑，与 todo-board 同交互；点空白/Esc 取消，有改动轻提示） */
export default function NotePanel(opts: {
  c: TodoRow;
  actions: TodoActions;
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { c, actions, setMsg } = opts;
  const {
    noteTitle, setNoteTitle, noteText, setNoteText, noteDue, setNoteDue,
    noteRepeat, setNoteRepeat, noteDoneCount, setNoteOpen, saveNote,
  } = actions;
  return (
    <Dismissable
      onClose={() => {
        const dirty =
          noteTitle !== c.title ||
          noteText !== (c.note ?? "") ||
          noteDue !== isoToLocalInput(c.due_at) ||
          noteRepeat !== c.repeat_daily;
        if (dirty) setMsg({ ok: true, text: "已取消，未保存" });
        setNoteOpen(null);
      }}
      className="ml-8 mt-1 rounded-lg border border-sky-500/40 bg-elevated/60 p-2.5"
    >
      <input
        autoFocus
        value={noteTitle}
        onChange={(e) => setNoteTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveNote();
          if (e.key === "Escape") setNoteOpen(null);
        }}
        className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-[13px] outline-none focus:border-sky-500"
        placeholder="标题"
      />
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value.slice(0, 1000))}
        rows={4}
        maxLength={1000}
        placeholder="详细内容（可选，记录细节/链接/备注，≤1000 字）"
        className="input-glow mt-2 w-full resize-none rounded border border-line-soft bg-surface/60 px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-ink-faint"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[10px] tabular-nums text-ink-faint">{noteText.length}/1000</span>
        <input
          type="datetime-local"
          value={noteDue}
          onChange={(e) => setNoteDue(e.target.value)}
          title="截止时间（可清空）"
          className="rounded border border-line-strong bg-surface px-2 py-1 text-[12px] tabular-nums outline-none focus:border-sky-500"
        />
        <label
          title="每日重复：完成后次日 06:00 自动恢复未完成，并累积完成次数"
          className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11px] transition ${
            noteRepeat ? "bg-emerald-500/20 text-success" : "border border-line-soft text-ink-mute hover:text-ink"
          }`}
        >
          <input
            type="checkbox"
            checked={noteRepeat}
            onChange={(e) => setNoteRepeat(e.target.checked)}
            className="h-3 w-3 accent-emerald-500"
          />
          🔁 每日{noteRepeat && noteDoneCount > 0 ? ` · 已完成 ×${noteDoneCount}` : ""}
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setNoteOpen(null)} className="rounded px-2.5 py-1 text-xs text-ink-mute hover:bg-soft">
            取消
          </button>
          <button
            onClick={() => void saveNote()}
            disabled={!noteTitle.trim()}
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </Dismissable>
  );
}
