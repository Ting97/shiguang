"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Dismissable } from "@/components/dismissable";

/** 触摸端识别行操作菜单：图标默认隐藏（触摸无 hover，RowAction 不渲染），点行弹出。
 * 删除沿用两步确认：第一次点变「确认删除?」（同时 arm 上层的 delArmed），第二次点执行。 */
export interface RowMenuState {
  x: number;
  y: number;
  /** 打开方给的行键：再点同行关闭仲裁用（open/close 成对提供后由 hook 维护） */
  key: string;
  /** 无编辑入口的行（人物/饮食）省略 */
  onEdit?: () => void;
  /** 调用方传 del(key, fn)：第一次触发 arm、第二次触发执行 */
  onDelete: () => void;
}

/**
 * 行菜单状态 + 再点同行关闭仲裁：菜单开着时再点同一行，Dismissable 的 document pointerdown
 * 先关闭、行 onClick 又立即以新坐标重开——菜单永远关不上（十一轮 todo-board 同族）。
 * close 记下 (key, at)，open 对 300ms 内同 key 的二次点击视为关闭操作（todo-board 口径）。
 */
export function useRowMenu() {
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const closedRef = useRef<{ at: number; key: string } | null>(null);
  const open = (key: string, m: Omit<RowMenuState, "key">) => {
    const closed = closedRef.current;
    if (closed && closed.key === key && Date.now() - closed.at < 300) return; // 刚被本次点击的 pointerdown 关闭：视为关闭操作
    setMenu({ ...m, key });
  };
  const close = () => {
    setMenu((m) => {
      if (m?.key) closedRef.current = { at: Date.now(), key: m.key };
      return null;
    });
  };
  return { menu, open, close };
}

export function RowActionMenu({ menu, onClose }: { menu: RowMenuState | null; onClose: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [menu]);
  if (!menu) return null;
  // 移动端底部弹层（全站菜单统一形态，todo/row-menu 同款）；≥640 视口维持锚定坐标卡
  //（平板横屏/桌面触屏）——旧版在窄视口也弹锚定卡，与四向约束冲突时成部分宽度悬空面板
  const anchored = window.innerWidth >= 640;
  const x = anchored ? Math.min(Math.max(menu.x, 8), window.innerWidth - 148) : 0;
  const y = anchored ? Math.min(Math.max(menu.y, 8), window.innerHeight - 116) : 0;
  return createPortal(
    <Dismissable
      onClose={onClose}
      className={`fixed z-[70] border border-line-soft bg-elevated p-1 shadow-2xl shadow-scrim/60 ${
        anchored ? "w-36 rounded-xl" : "inset-x-0 bottom-0 rounded-t-2xl pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
      }`}
      style={anchored ? { left: x, top: y } : undefined}
    >
      {!anchored && <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-soft" />}
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
