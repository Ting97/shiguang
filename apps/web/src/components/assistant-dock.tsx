"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import AssistantChat from "@/app/assistant/chat-core";

/**
 * 首页拾光助手悬浮 Dock（REQ-015 追加）：
 * - 桌面（≥sm）：悬浮球点开右下面板，头部「化小」或再点悬浮球收回——收起仅隐藏不卸载，对话状态保留
 * - 移动（<sm）：悬浮球跳整页 /assistant（竖屏键入体验优先，面板化在小屏没有意义）
 */
export default function AssistantDock() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false); // 首次点开才挂载聊天核心（不预拉 /api/chat）
  const [open, setOpen] = useState(false);
  const mqRef = useRef<MediaQueryList | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    mqRef.current = mq;
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      if (!e.matches) setOpen(false); // 跨断点缩窄：小屏强制收回（整页入口接管）
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setMounted(true);
    setOpen((v) => !v);
  }, []);

  return (
    <>
      {/* 面板：化小仅隐藏不卸载（保留对话状态）；首次点开才挂载 */}
      {isDesktop && mounted && (
        <div
          className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 h-[min(72dvh,640px)] w-[400px] max-w-[calc(100vw-2rem)] ${
            open ? "flex flex-col" : "hidden"
          }`}
        >
          <AssistantChat variant="dock" onMinimize={() => setOpen(false)} />
        </div>
      )}

      {/* 悬浮球：桌面=开/化小开关（展开时藏球，面板头部有化小钮）；移动=整页链接 */}
      {isDesktop ? (
        !open && (
          <button
            onClick={toggle}
            aria-expanded={open}
            aria-label="打开拾光助手"
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-surface/90 px-3.5 py-2.5 text-xs font-medium text-ai shadow-lg shadow-scrim/40 backdrop-blur transition hover:border-violet-500/70"
          >
            <Sparkles size={15} aria-hidden /> 拾光助手
          </button>
        )
      ) : (
        <Link
          href="/assistant"
          aria-label="拾光助手"
          className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-surface/90 px-3.5 py-2.5 text-xs font-medium text-ai shadow-lg shadow-scrim/40 backdrop-blur transition hover:border-violet-500/70"
        >
          <Sparkles size={15} aria-hidden /> 拾光助手
        </Link>
      )}
    </>
  );
}
