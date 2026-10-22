"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import AssistantChat, { SCOPE_META, type ChatScope } from "@/app/assistant/chat-core";
import { useSession } from "@/shared/session";

/**
 * 助手悬浮 Dock（REQ-015 追加；REQ-019 分域参数化）：
 * - 桌面（≥sm）：悬浮球点开右下面板，头部「化小」或再点悬浮球收回——收起仅隐藏不卸载，对话状态保留
 * - 移动（<sm）：悬浮球跳整页 /assistant?scope=…（竖屏键入体验优先，面板化在小屏没有意义）
 * - scope="global"（默认）= 首页全局拾光助手；各域主页与运动空间传各自域
 */
export default function AssistantDock({ scope = "global" }: { scope?: ChatScope }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false); // 首次点开才挂载聊天核心（不预拉 /api/chat）
  const [open, setOpen] = useState(false);
  const mqRef = useRef<MediaQueryList | null>(null);
  const meta = SCOPE_META[scope];

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

  // 模块联动（REQ-028）：ai 关 → 全站不挂；scope 域模块关 → 该页不挂（ChatScope 域值恰与模块 key 同名）
  const { user } = useSession();
  if (user && (!user.modules.includes("ai") || (scope !== "global" && !user.modules.includes(scope)))) {
    return null;
  }

  return (
    <>
      {/* 面板：化小仅隐藏不卸载（保留对话状态）；首次点开才挂载；key=scope 换域即换实例 */}
      {isDesktop && mounted && (
        <div
          key={scope}
          className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 h-[min(72dvh,640px)] w-[400px] max-w-[calc(100vw-2rem)] ${
            open ? "flex flex-col" : "hidden"
          }`}
        >
          <AssistantChat variant="dock" scope={scope} onMinimize={() => setOpen(false)} />
        </div>
      )}

      {/* 悬浮球：桌面=开/化小开关（展开时藏球，面板头部有化小钮）；移动=整页链接 */}
      {isDesktop ? (
        !open && (
          <button
            onClick={toggle}
            aria-label={`打开${meta.dockLabel}`}
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-surface/90 px-3.5 py-2.5 text-xs font-medium text-ai shadow-lg shadow-scrim/40 backdrop-blur transition hover:border-violet-500/70"
          >
            <Sparkles size={15} aria-hidden /> {meta.dockLabel}
          </button>
        )
      ) : (
        <Link
          href={scope === "global" ? "/assistant" : `/assistant?scope=${scope}`}
          aria-label={meta.dockLabel}
          className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-surface/90 px-3.5 py-2.5 text-xs font-medium text-ai shadow-lg shadow-scrim/40 backdrop-blur transition hover:border-violet-500/70"
        >
          <Sparkles size={15} aria-hidden /> {meta.dockLabel}
        </Link>
      )}
    </>
  );
}
