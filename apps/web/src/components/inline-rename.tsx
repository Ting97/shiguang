"use client";

import { useEffect, useRef, useState } from "react";
import { useDismiss } from "./dismissable";

/**
 * N4 空间名称就地编辑（REQ-002 FR-N4）：展示态 ⇄ 编辑态。
 * Enter 保存（onSave 成功后回调刷新）、点空白/Esc 取消（N3 语义，内部 useDismiss）。
 */
export default function InlineRename({
  value,
  onSave,
  className = "",
  maxLength = 40,
}: {
  value: string;
  onSave: (name: string) => Promise<boolean>; // 返回 true=保存成功（退出编辑态）
  className?: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(value);
  // 保存进行中：禁用输入框 + 拦截再次提交，防连击/重复保存
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(value), [value]);

  const cancel = () => {
    setName(value);
    setErr(null);
    setEditing(false);
  };

  const ref = useDismiss<HTMLSpanElement>(cancel, editing);

  async function save() {
    if (busyRef.current) return;
    const t = name.trim();
    if (!t) {
      setErr("名称不能为空");
      return;
    }
    if ([...t].length > maxLength) {
      setErr(`名称过长（≤${maxLength} 字）`);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await onSave(t);
      if (ok) setEditing(false);
    } catch {
      // 兜底：异常不抛出点击处理器（裸 rejection 会触发整页刷新），转成行内错误提示
      setErr("网络异常，请稍后重试");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className={`group/rename inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}>
        <span className="min-w-0 truncate">{value}</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          title="重命名"
          className="row-actions-hidden hidden shrink-0 rounded px-1 text-[11px] text-ink-mute transition hover:text-accent group-hover/rename:block"
        >
          ✏️
        </button>
      </span>
    );
  }

  return (
    <span
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}
    >
      <input
        ref={inputRef}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value.slice(0, maxLength))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
        }}
        maxLength={maxLength}
        className="input-glow min-w-0 rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
      />
      {err && <span className="text-[10px] text-danger">{err}</span>}
    </span>
  );
}
