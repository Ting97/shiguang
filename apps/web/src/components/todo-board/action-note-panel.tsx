"use client";

import type { TodoRow } from "@/lib/types";
import { Dismissable } from "../dismissable";
import type { ActionNote } from "./use-action-note";

/**
 * 行动详情面板（拆分自 todo-board，行为零变化）：
 * N3：点空白/Esc 取消，有改动轻提示（dirty 判定复刻在 hook 的 closeNote）。
 */
export function ActionNotePanel({ c, note }: { c: TodoRow; note: ActionNote }) {
  return (
    <Dismissable
      onClose={() => note.closeNote(c)}
      className="rounded-lg border border-sky-500/40 bg-elevated/60 p-2.5"
    >
      <input
        autoFocus
        value={note.noteTitle}
        onChange={(e) => note.setNoteTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) note.saveNote();
          if (e.key === "Escape") note.setNoteOpenId(null);
        }}
        className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-[13px] outline-none focus:border-sky-500"
        placeholder="标题"
      />
      <textarea
        value={note.noteText}
        onChange={(e) => note.setNoteText(e.target.value.slice(0, 1000))}
        rows={4}
        maxLength={1000}
        placeholder="详细内容（可选，记录细节/链接/备注，≤1000 字）"
        className="input-glow mt-2 w-full resize-none rounded border border-line-soft bg-surface/60 px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-ink-faint"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[10px] tabular-nums text-ink-faint">{note.noteText.length}/1000</span>
        <input
          type="datetime-local"
          value={note.noteDue}
          onChange={(e) => note.setNoteDue(e.target.value)}
          title="截止时间（可清空）"
          className="rounded border border-line-strong bg-surface px-2 py-1 text-[12px] tabular-nums outline-none focus:border-sky-500"
        />
        <label
          title="每日重复：完成后次日 06:00 自动恢复未完成，并累积完成次数"
          className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11px] transition ${
            note.noteRepeat ? "bg-emerald-500/20 text-success" : "border border-line-soft text-ink-mute hover:text-ink"
          }`}
        >
          <input
            type="checkbox"
            checked={note.noteRepeat}
            onChange={(e) => note.setNoteRepeat(e.target.checked)}
            className="h-3 w-3 accent-emerald-500"
          />
          🔁 每日{note.noteRepeat && note.noteDoneCount > 0 ? ` · 已完成 ×${note.noteDoneCount}` : ""}
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => note.setNoteOpenId(null)} className="rounded px-2.5 py-1 text-xs text-ink-mute hover:bg-soft">
            取消
          </button>
          <button
            onClick={note.saveNote}
            disabled={note.noteSaving || !note.noteTitle.trim()}
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            {note.noteSaving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Dismissable>
  );
}
