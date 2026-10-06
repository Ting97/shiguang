"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Dismissable } from "@/components/dismissable";

/** 触摸端识别行操作菜单：图标默认隐藏（触摸无 hover，RowAction 不渲染），点行弹出。
 * 删除沿用两步确认：第一次点变「确认删除?」（同时 arm 上层的 delArmed），第二次点执行。 */
export interface RowMenuState {
  x: number;
  y: number;
  /** 无编辑入口的行（人物/饮食）省略 */
  onEdit?: () => void;
  /** 调用方传 del(key, fn)：第一次触发 arm、第二次触发执行 */
  onDelete: () => void;
}

export function RowActionMenu({ menu, onClose }: { menu: RowMenuState | null; onClose: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [menu]);
  if (!menu) return null;
  const x = Math.min(Math.max(menu.x, 8), window.innerWidth - 148);
  const y = Math.min(Math.max(menu.y, 8), window.innerHeight - 116);
  return createPortal(
    <Dismissable
      onClose={onClose}
      className="fixed z-[70] w-36 rounded-xl border border-line-soft bg-elevated p-1 shadow-2xl shadow-scrim/60"
      style={{ left: x, top: y }}
    >
      {menu.onEdit && (
        <button
          onClick={() => {
            onClose();
            menu.onEdit!();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
        >
          <Pencil size={13} className="text-accent" />
          编辑
        </button>
      )}
      <button
        onClick={() => {
          menu.onDelete();
          if (armed) onClose();
          else setArmed(true);
        }}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-rose-500/10 ${
          armed ? "font-medium text-danger" : "text-ink"
        }`}
      >
        <Trash2 size={13} className="text-danger" />
        {armed ? "确认删除?" : "删除"}
      </button>
    </Dismissable>,
    document.body,
  );
}
