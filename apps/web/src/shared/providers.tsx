"use client";

/** 客户端 Providers（4-F）：SessionProvider + 全局 Toast，挂在根布局 */
import { SessionProvider } from "@/shared/session";
import { ToastHost } from "@/shared/ui/toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <ToastHost />
    </SessionProvider>
  );
}
