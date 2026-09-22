"use client";

/**
 * 全局 Toast（REQ-004 FR-E1.3 / 4-F）：命令式 toast() + ToastHost。
 * 收编各页重复的消息横幅状态模式（15 处）；自动消失，Esc 可关。
 */
import { useEffect, useState } from "react";

type ToastKind = "ok" | "err";
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

let listeners: ((t: ToastItem) => void) | null = null;
let seq = 0;

export function toast(text: string, kind: ToastKind = "ok") {
  listeners?.({ id: ++seq, text, kind });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners = (t) => {
      setItems((arr) => [...arr, t]);
      setTimeout(() => setItems((arr) => arr.filter((x) => x.id !== t.id)), t.kind === "ok" ? 3500 : 8000);
    };
    return () => {
      listeners = null;
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`msg-banner w-full max-w-md ${t.kind === "ok" ? "msg-banner-ok" : "msg-banner-err"}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
