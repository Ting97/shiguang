"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/components/ui/use-body-scroll-lock";
import { useDismiss } from "./dismissable";

/**
 * N2 感悟编辑器（REQ-002 FR-N2.2/2.3）：底部抽屉，自适应 textarea + 字数（码点口径，与 DB char_length 一致）。
 * 超限禁存；取消（点空白/Esc/×）时若有改动 → 轻提示「已取消，未保存」（N3.5）。
 */
export default function ReflectionEditor({
  open,
  initial,
  busy,
  notify,
  onCancel,
  onSave,
}: {
  open: boolean;
  /** 编辑模式回填全文；新建传 "" */
  initial: string;
  busy: boolean;
  /** N3.5 取消且有改动时的轻提示 */
  notify?: (m: { ok: boolean; text: string } | null) => void;
  onCancel: () => void;
  onSave: (content: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const initialRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setValue(initial);
    initialRef.current = initial;
    const t = setTimeout(() => taRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, initial]);

  // useCallback 稳定化：内联声明每渲染新建会让 useDismiss 每次击键都重订阅全局 pointerdown/keydown
  // （publish-sheet 同款先例）；依赖用 value 而非下方 dirty（deps 需在渲染期可读）
  const cancel = useCallback(() => {
    // N3.5：有改动时轻提示「已取消，未保存」（不弹确认，保持轻量）
    if (value !== initialRef.current) notify?.({ ok: true, text: "已取消，未保存" });
    onCancel();
  }, [value, notify, onCancel]);

  const panelRef = useDismiss<HTMLDivElement>(cancel, open);
  // body 滚动锁：抽屉打开期间锁背景滚动，关闭/卸载还原
  useBodyScrollLock(open);
  if (!open) return null;

  const chars = Array.from(value).length; // 码点计数，与 DB char_length 同口径
  const over = chars > 50_000;
  async function save() {
    if (over || busy || !value.trim()) return;
    const ok = await onSave(value.trim());
    if (ok) initialRef.current = value.trim();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={panelRef}
        className="glass safe-bottom flex max-h-[88dvh] w-full flex-col rounded-t-2xl p-5 sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{initialRef.current ? "编辑感悟" : "写感悟"}</h3>
          <button onClick={cancel} aria-label="关闭" className="rounded p-1 text-ink-dim hover:text-ink"><X size={14} /></button>
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            // length ≥ 码点数：未超限不做 O(n) 码点展开（5 万字长文每键全展开是纯浪费）
            if (next.length > 50_000 && [...next].length > 50_000) {
              setValue(Array.from(next).slice(0, 50_000).join(""));
              return;
            }
            setValue(next);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (pasted && (value + pasted).length > 50_000 && [...(value + pasted)].length > 50_000) {
              e.preventDefault();
              const merged = Array.from(value + pasted).slice(0, 50_000).join("");
              setValue(merged);
            }
          }}
          placeholder="记录阶段心得、踩坑复盘、自我对话……（纯文本，单篇 ≤50000 字）"
          className="input-glow min-h-[40vh] w-full flex-1 resize-none rounded-xl border border-line-soft bg-surface/60 px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-ink-faint"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={`text-micro tabular-nums ${over ? "text-danger" : chars > 45_000 ? "text-warn" : "text-ink-faint"}`}>
            {chars}/50000{over ? " · 超出上限" : ""}
          </span>
          <div className="flex gap-2">
            <button onClick={cancel} className="rounded-xl px-4 py-2 text-xs text-ink-mute hover:bg-soft">
              取消
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || over || !value.trim()}
              className="btn-primary rounded-xl px-5 py-2 text-xs font-medium disabled:opacity-50"
              title={over ? "超出 50000 字上限" : ""}
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
