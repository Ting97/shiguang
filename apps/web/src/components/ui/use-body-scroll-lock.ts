"use client";

/**
 * body 滚动锁（自 ui/modal 抽出复用）：active 为真期间锁背景滚动，
 * 失活/卸载时还原原 overflow（scrim/fixed 弹层下指针落遮罩上背景会跟手滚）。
 * 供 Modal 壳与手写全屏弹层（publish-sheet/reflection-editor/import-drawer/lightbox）共用。
 */
import { useEffect } from "react";

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
