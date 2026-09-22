"use client";

import { useDismiss } from "./dismissable";

/**
 * N1 空间关联浮层（REQ-002 FR-N1.1/1.2）：列出 active 空间供关联/切换；
 * 当前关联的是归档空间时置灰展示、仅可移除；底部「移除关联」（未关联时隐藏）。点空白/Esc 关闭（N3）。
 */
export default function SpacePicker({
  spaces,
  currentId,
  busy,
  onPick,
  onRemove,
  onClose,
}: {
  spaces: Array<{ id: string; name: string; icon: string; color: string; status: string }>;
  /** 当前关联的空间 id（null=未关联） */
  currentId: string | null;
  busy: boolean;
  onPick: (spaceId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  const current = spaces.find((s) => s.id === currentId) ?? null;
  const currentArchived = current?.status === "archived";
  const pickable = spaces.filter((s) => s.status === "active");

  return (
    // 桌面端无锚点信息，fixed+auto inset 会落到文档流末尾（视口外）→ 显式居中；移动端保持底部弹层
    <div
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-64 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-2"
    >
      <p className="mb-1.5 px-1.5 text-[11px] font-medium text-ink-dim">关联目标空间</p>
      <div className="space-y-0.5">
        {pickable.map((s) => {
          const isCurrent = s.id === currentId;
          return (
            <button
              key={s.id}
              disabled={busy || isCurrent}
              onClick={() => onPick(s.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition disabled:opacity-60 ${
                isCurrent ? "bg-sky-500/10 text-accent" : "text-ink hover:bg-wash"
              }`}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm leading-none"
                style={{ backgroundColor: `${s.color}26` }}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {isCurrent && <span className="shrink-0 text-[10px]">已关联</span>}
            </button>
          );
        })}
        {pickable.length === 0 && (
          <p className="px-1.5 py-2 text-[11px] text-ink-faint">还没有进行中的空间 —— 先到「目标」页创建</p>
        )}

        {/* 归档中的当前关联：置灰展示，不可新选（自身已不在 pickable 中） */}
        {currentArchived && current && (
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs opacity-50">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm leading-none grayscale"
              style={{ backgroundColor: `${current.color}26` }}
            >
              {current.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{current.name}</span>
            <span className="shrink-0 text-[10px] text-ink-faint">已归档</span>
          </div>
        )}

        {currentId && (
          <button
            disabled={busy}
            onClick={onRemove}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10 disabled:opacity-40"
          >
            <span className="w-6 shrink-0 text-center text-sm leading-none">🚫</span>
            移除关联
          </button>
        )}
      </div>
    </div>
  );
}
