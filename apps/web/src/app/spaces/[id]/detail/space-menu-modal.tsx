"use client";

import { createPortal } from "react-dom";
import { Dismissable } from "@/components/dismissable";
import type { Dispatch, SetStateAction } from "react";
import type { Space } from "@/lib/types";
import type { Pos } from "./types";

/** 空间操作菜单（自 detail.tsx 拆出；⋯ 收纳归档/删除；桌面锚定浮层 / 移动端底部弹层） */
export default function SpaceMenuModal(opts: {
  space: Space;
  pos: Pos | null;
  setSpaceMenu: Dispatch<SetStateAction<boolean>>;
  setStatus: (status: "active" | "archived") => Promise<void>;
  removeSpace: () => Promise<void>;
}) {
  const { space, pos, setSpaceMenu, setStatus, removeSpace } = opts;
  return createPortal(
    <Dismissable
      onClose={() => setSpaceMenu(false)}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
      <p className="mb-1.5 truncate px-1.5 text-[11px] font-medium text-ink-dim">{space.name}</p>
      <div className="space-y-0.5">
        {space.status === "archived" ? (
          <button
            onClick={() => setStatus("active")}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
          >
            <span className="w-5 shrink-0 text-center text-sm leading-none">📤</span>
            <span className="min-w-0 flex-1">恢复空间</span>
          </button>
        ) : (
          <button
            onClick={() => setStatus("archived")}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-warn transition hover:bg-wash"
          >
            <span className="w-5 shrink-0 text-center text-sm leading-none">📦</span>
            <span className="min-w-0 flex-1">归档空间</span>
          </button>
        )}
        <button
          onClick={() => { setSpaceMenu(false); void removeSpace(); }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10"
        >
          <span className="w-5 shrink-0 text-center text-sm leading-none">🗑</span>
          <span className="min-w-0 flex-1">删除空间</span>
        </button>
      </div>
    </Dismissable>,
    document.body,
  );
}
