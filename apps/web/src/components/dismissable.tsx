"use client";

import { useEffect, useRef } from "react";

/**
 * 全站软性浮层统一关闭（REQ-002 N3）：
 * - 挂载后下一次 pointerdown 才生效（打开浮层的那次点击不会误关）
 * - pointerdown 落在浮层外 / 按下 Esc → onClose()
 * - onClose 语义由调用方定义：编辑器=收起+未保存提示；菜单=纯关闭；确认框=取消分支
 * 约定：子浮层渲染在父浮层 DOM 子树内自然豁免；无法同子树时由打开方互斥（一次只开一个同级浮层）。
 */
export function useDismiss<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, active]);
  return ref;
}

/** 便捷包装：把 ref 挂到浮层根元素上 */
export function Dismissable({
  onClose,
  className,
  style,
  children,
  active = true,
}: {
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  active?: boolean;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose, active);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
