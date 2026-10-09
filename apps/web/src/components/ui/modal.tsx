"use client";

/**
 * 全站唯一弹层壳（REQ-009 FR-B2）：scrim+blur、Esc/点外关闭、焦点圈定与归还、
 * 进场动画（桌面弹入 / 移动端底部抽屉上滑）、role="dialog"。
 * API 与旧 finance/display.tsx Modal 保持一致（title + onClose + children），迁移 = 换 import。
 * 软性浮层（菜单/气泡）仍走 Dismissable 范式，不经过本壳。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "@/components/dismissable";
import { useBodyScrollLock } from "@/components/ui/use-body-scroll-lock";
import { X } from "lucide-react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** md=常态表单弹层；lg=宽内容（导入向导/预览） */
  size?: "md" | "lg";
}) {
  const dismissRef = useDismiss<HTMLDivElement>(onClose);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      dismissRef.current = node;
    },
    [dismissRef],
  );

  // 焦点管理：打开→聚焦首个可聚焦元素；Tab 圈定在弹层内；卸载→焦点归还触发元素。
  // 依赖 [mounted]：首帧 SSR/水合前 mounted=false 渲染 null，cardRef 未挂载；
  // 空依赖数组会让三段焦点逻辑永不执行（死代码，009 轮修复）
  useEffect(() => {
    if (!mounted) return;
    const card = cardRef.current;
    if (!card) return;
    const prev = document.activeElement as HTMLElement | null;
    // 初始聚焦优先级：首个输入控件（表单弹层打开即可打字）→ 首个可聚焦元素 → 卡片本体
    const firstInput = card.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])");
    const first = card.querySelector<HTMLElement>(FOCUSABLE);
    (firstInput ?? first ?? card).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [mounted]);

  // body 滚动锁：浮层打开期间锁背景滚动，卸载还原（scrim 是 fixed，指针落在遮罩上背景会跟手滚）
  useBodyScrollLock(mounted);

  if (!mounted) return null;
  return createPortal(
    <div className="anim-scrim-in fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={setCardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`anim-modal-pop glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 outline-none sm:rounded-2xl ${
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="press rounded-md p-1.5 text-ink-dim hover:text-ink"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
