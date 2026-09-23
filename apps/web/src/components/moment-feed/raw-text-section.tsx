"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { FeedMoment } from "@/lib/types";
import { Dismissable } from "../dismissable";
import type { CardMsg, MenuPos } from "./types";

interface RawTextSectionProps {
  m: FeedMoment;
  /** 原文行内编辑：null=非编辑态；字符串=textarea 当前内容 */
  editRaw: string | null;
  setEditRaw: Dispatch<SetStateAction<string | null>>;
  /** 点原文时收起「⋯」操作菜单，两个浮层互斥 */
  setActionsOpen: Dispatch<SetStateAction<boolean>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMenuPos: Dispatch<SetStateAction<MenuPos>>;
  /** 点空白取消编辑且有改动时的轻提示 */
  setCardMsg: Dispatch<SetStateAction<CardMsg>>;
  onSaveRaw: () => void;
}

/** 原文区：编辑态 textarea；否则点击弹出「识别与补充」菜单；长文折叠 */
export function RawTextSection({
  m,
  editRaw,
  setEditRaw,
  setActionsOpen,
  setMenuOpen,
  setMenuPos,
  setCardMsg,
  onSaveRaw,
}: RawTextSectionProps) {
  // 长文折叠：超过 150 字默认收起 6 行，用独立「展开全文」按钮（不与"点原文弹识别菜单"抢交互）
  const [textExpanded, setTextExpanded] = useState(false);
  const isLongText = m.raw_text.length > 150;

  return (
    <>
      {editRaw !== null ? (
        <Dismissable
          onClose={() => {
            // N3/N3.5：点空白或 Esc 取消编辑；内容有改动则轻提示
            if (editRaw.trim() !== m.raw_text.trim()) setCardMsg({ ok: true, text: "已取消，未保存" });
            setEditRaw(null);
          }}
          className="mt-1.5"
        >
          <textarea
            value={editRaw}
            onChange={(e) => setEditRaw(e.target.value)}
            rows={Math.min(6, Math.max(2, editRaw.split("\n").length + 1))}
            autoFocus
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[15px] leading-relaxed text-ink outline-none focus:border-sky-500"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={onSaveRaw}
              className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
            >
              保存并重新识别
            </button>
            <button onClick={() => setEditRaw(null)} className="px-1 text-xs text-ink-mute hover:text-ink">
              取消
            </button>
          </div>
        </Dismissable>
      ) : (
        <p
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const desktop = window.innerWidth >= 640;
            setMenuPos(
              desktop
                ? {
                    top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 360)),
                    left: Math.max(8, Math.min(r.right - 300, window.innerWidth - 316)),
                  }
                : null,
            );
            setActionsOpen(false);
            setMenuOpen((v) => !v);
          }}
          title="点击打开识别菜单"
          className={`mt-1.5 cursor-pointer whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink transition-colors hover:text-white ${isLongText && !textExpanded ? "line-clamp-6" : ""}`}
        >
          {m.raw_text}
        </p>
      )}
      {editRaw === null && isLongText && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setTextExpanded((v) => !v);
          }}
          className="mt-1 text-xs font-medium text-accent hover:underline"
        >
          {textExpanded ? "收起" : `展开全文（${m.raw_text.length} 字）`}
        </button>
      )}
    </>
  );
}
