"use client";

/**
 * 全局 Toast（REQ-009 FR-B1）：命令式 toast() + ToastHost。
 * 全站操作反馈唯一出口：ok=成功 / err=失败 / info=提示。
 * 自动消失（ok 3.2s / info 4.2s / err 8s）、点击关闭、Esc 关最旧、同屏 ≤3 条。
 * 表单行内错误不走这里（就近展示原则），这里只做操作结果与全局提示。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "ok" | "err" | "info";
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  /** 离场中：先播 200ms 收起动画再移除 */
  leaving?: boolean;
}

let push: ((t: ToastItem) => void) | null = null;
let dismissOldest: (() => void) | null = null;
let seq = 0;

const DURATION_MS: Record<ToastKind, number> = { ok: 3200, info: 4200, err: 8000 };
const LEAVE_MS = 200;
const MAX_VISIBLE = 3;

/** 发一条全局 toast：toast("已保存") / toast("保存失败：…", "err") / toast("已复制", "info") */
export function toast(text: string, kind: ToastKind = "ok") {
  push?.({ id: ++seq, text, kind });
}

const ICONS: Record<ToastKind, typeof CheckCircle2> = { ok: CheckCircle2, err: AlertCircle, info: Info };

const TONE: Record<ToastKind, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-success",
  err: "border-rose-500/30 bg-rose-500/10 text-danger",
  info: "border-sky-500/30 bg-sky-500/10 text-accent",
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((arr) => arr.filter((x) => x.id !== id)), LEAVE_MS);
  }, []);

  useEffect(() => {
    push = (t) => {
      setItems((arr) => {
        // 同屏超过上限：最旧一条立即让位
        const next = arr.length >= MAX_VISIBLE ? arr.slice(1) : arr;
        return [...next, t];
      });
      setTimeout(() => remove(t.id), DURATION_MS[t.kind]);
    };
    dismissOldest = () => {
      setItems((arr) => {
        if (arr.length > 0) remove(arr[0].id);
        return arr;
      });
    };
    return () => {
      push = null;
      dismissOldest = null;
    };
  }, [remove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissOldest?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (items.length === 0) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => remove(t.id)}
            title="点击关闭"
            className={`msg-banner pointer-events-auto flex w-full max-w-md cursor-pointer items-start gap-2 text-left transition-all duration-200 ${
              t.leaving ? "-translate-y-1 opacity-0" : "fade-up"
            } ${TONE[t.kind]}`}
          >
            <Icon size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-words">{t.text}</span>
            <X size={13} className="mt-0.5 shrink-0 opacity-50" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
