"use client";

import { useEffect, useRef } from "react";

/**
 * 全站软性浮层统一关闭（REQ-002 N3）：
 * - 挂载后下一次 pointerdown 才生效（打开浮层的那次点击不会误关）
 * - pointerdown 落在浮层外 / 按下 Esc → onClose()
 * - 例外：pointerdown 落在带 data-popover-trigger 标记的触发元素内不关闭——
 *   该次点击的开/关交给触发钮自己的 toggle 处理，避免"pointerdown 先关、click 又开"的闪烁
 * - onClose 语义由调用方定义：编辑器=收起+未保存提示；菜单=纯关闭；确认框=取消分支
 * 约定：子浮层渲染在父浮层 DOM 子树内自然豁免；无法同子树时由打开方互斥（一次只开一个同级浮层）。
 */
export function useDismiss<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-popover-trigger]")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // IME 组合中按 Esc 是取消候选词，不是关闭浮层——不判 isComposing 会把正在打字的草稿整个关掉
      //（十四轮 P2：Enter 路径全站已守，Esc 路径系统性漏守，此处是全站单点）
      if (e.key === "Escape" && !e.isComposing && !(e.keyCode === 229)) {
        // 标记本次 Esc 已被浮层消费：ToastHost 的「Esc 关最旧 toast」同键监听 window 冒泡，
        // 浮层关闭瞬间弹出的操作提示（如「已取消，未保存」）会被它当最旧 toast 立即吃掉——
        // 脏表单 Esc 关闭从此无任何反馈（十九轮实测定位）。preventDefault 是消费标记，
        // ToastHost 侧见 defaultPrevented 让位
        e.preventDefault();
        onClose();
      }
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
