"use client";

import { createPortal } from "react-dom";
import { Dismissable } from "@/components/dismissable";
import type { MomentLinkActions } from "./use-moment-link";

/** C1「关联未归属动态」浮层（自 detail.tsx 拆出；桌面居中 / 移动端底部弹层） */
export default function MomentLinkModal(opts: {
  open: boolean;
  momentLink: MomentLinkActions;
}) {
  const { open, momentLink } = opts;
  const {
    setMomentLinkOpen,
    momentItems, momentTotal, momentQuery, onMomentQueryChange, momentLoading,
    loadUnlinkedMoments, linkMoment,
  } = momentLink;
  if (!open) return null;
  return createPortal(
    <Dismissable
      onClose={() => setMomentLinkOpen(false)}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-80 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-3"
    >
      <p className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-xs font-semibold text-ink">关联未归属动态</span>
        <span className="text-[10px] tabular-nums text-ink-faint">{momentTotal} 条未归属</span>
      </p>
      <input
        autoFocus
        value={momentQuery}
        onChange={(e) => onMomentQueryChange(e.target.value)}
        placeholder="搜索原文关键字…"
        className="mb-2 w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-sky-500"
      />
      <div className="max-h-[46dvh] space-y-0.5 overflow-y-auto sm:max-h-72">
        {momentItems.map((m) => (
          <button
            key={m.id}
            onClick={() => void linkMoment(m.id)}
            className="w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-wash"
          >
            {/* 北京口径时间戳（toLocaleString 按设备时区，海外设备会跨日错位；同 moments-section bjStamp） */}
            <span className="block text-[10px] text-ink-faint">
              {new Date(new Date(m.created_at).getTime() + 8 * 3600_000)
                .toISOString()
                .slice(5, 16)
                .replace("T", " ")}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-ink">{m.raw_text}</span>
          </button>
        ))}
        {momentItems.length === 0 && !momentLoading && (
          <p className="px-2 py-6 text-center text-[11px] text-ink-faint">
            {momentQuery ? "没有匹配的动态" : "没有未归属的动态 —— 全部都已归入空间"}
          </p>
        )}
        {momentLoading && <p className="px-2 py-4 text-center text-[11px] text-ink-faint">加载中…</p>}
      </div>
      {momentItems.length < momentTotal && (
        <button
          onClick={() => void loadUnlinkedMoments(momentQuery, momentItems.length)}
          className="mt-2 w-full rounded-lg border border-line-soft py-1.5 text-[11px] text-ink-mute transition hover:bg-soft"
        >
          加载更多（还有 {momentTotal - momentItems.length} 条）
        </button>
      )}
      <button
        onClick={() => setMomentLinkOpen(false)}
        className="mt-2 w-full rounded-lg border border-line-soft py-1.5 text-[11px] text-ink-mute transition hover:bg-soft"
      >
        关闭
      </button>
    </Dismissable>,
    document.body,
  );
}
