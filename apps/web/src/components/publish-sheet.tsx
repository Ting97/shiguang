"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 移动端发布输入面板（底部抽屉）：悬浮圆圈点按=空面板；长按语音松开=转写文字带入预览，
 * 用户确认/修改后点「发布」才真正提交（onPublish 成功由父级关面板）。
 */
export default function PublishSheet({
  open,
  initialText,
  busy,
  onPublish,
  onClose,
}: {
  open: boolean;
  /** 打开时带入的初始文字（语音转写结果或空串） */
  initialText: string;
  busy: boolean;
  onPublish: (text: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialText);
    // 等挂载/键盘弹起后再聚焦，保证光标落在面板输入框
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, initialText]);

  if (!open) return null;

  const publish = () => {
    const t = value.trim();
    if (!t || busy) return;
    void onPublish(t);
  };

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/50" onClick={onClose} />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-[56] rounded-t-2xl border-t border-line-soft bg-surface p-4 pb-5 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-soft">记录此刻</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-1 text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              publish();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          rows={3}
          maxLength={2000}
          placeholder='说点什么…（试试"刚跑完步40分钟，心情不错"、"明天下午三点看牙"）'
          className="input-glow w-full resize-none rounded-xl border border-line-soft bg-surface/60 px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-ink-faint">发布后 AI 自动识别日程 / 待办 / 收支 / 心情</span>
          <button
            type="button"
            onClick={publish}
            disabled={busy || !value.trim()}
            className="btn-primary rounded-xl px-7 py-2 text-sm font-medium"
          >
            {busy ? "识别中…" : "发布"}
          </button>
        </div>
      </div>
    </>
  );
}
