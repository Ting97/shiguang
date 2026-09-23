"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import ThemeToggle from "./theme-toggle";
import { useSession } from "@/shared/session";

const LINKS = [
  { href: "/", label: "动态" },
  { href: "/spaces", label: "目标" },
  { href: "/schedule", label: "日程" },
  { href: "/contacts", label: "人际" },
  { href: "/finance", label: "财务" },
];

// 预认证页不渲染导航（根布局统一挂载，登录/初始化页除外）
const NAVLESS_PATHS = ["/login", "/setup"];

export default function Nav() {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const navless = NAVLESS_PATHS.includes(pathname);

  useEffect(() => {
    // 移动端横滑时把当前激活项滚入可视区中央（否则访问靠后的模块看不出当前在哪）
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-path="${pathname}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  // 会话走全站唯一源 useSession（FR-E1.2）；401 跳转由 SessionProvider 统一处理
  const { user, logout } = useSession();
  const nickname = user?.nickname ?? null;
  const authDisabled = user?.authDisabled ?? false;

  if (navless) return null;

  const linkCls = (active: boolean) =>
    // 固定 min-width + 居中：激活态 font-medium 变宽时占位宽度不变（消除切换跳动）
    `shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-center text-[13px] transition-all duration-200 min-w-[3.5rem] sm:min-w-[4.5rem] sm:px-5 sm:py-1.5 sm:text-sm ${
      active
        ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
        : "text-ink-mute hover:bg-wash hover:text-ink"
    }`;

  return (
    // 根布局统一挂载：宽度恒为视口宽（不再随各页 max-w 容器变化），页内容间距由各页容器 pt 提供
    <nav className="sticky top-0 z-40 flex items-center justify-between gap-2 rounded-b-2xl border border-t-0 border-line-soft bg-surface/80 p-1 pl-4 pr-3 text-sm shadow-lg shadow-scrim/50 backdrop-blur-xl safe-top">
      <div ref={scrollRef} className="scrollbar-none flex min-w-0 flex-1 justify-start gap-1 overflow-x-auto sm:justify-center">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} data-path={l.href} className={linkCls(active)}>
              {l.label}
            </Link>
          );
        })}
      </div>
      <span className="flex shrink-0 items-center gap-1 pr-2">
        <ThemeToggle />
        {!authDisabled && nickname && (
          <span className="flex items-center gap-1.5 text-xs text-ink-mute">
            <Link
              href="/profile"
              title="个人设置"
              className={`max-w-[4.5rem] truncate rounded-full px-2 py-1.5 transition hover:bg-wash hover:text-accent sm:max-w-none sm:py-1 ${
                pathname === "/profile" ? "text-accent" : ""
              }`}
            >
              {nickname}
            </Link>
            <button
              onClick={logout}
              title="退出登录"
              className="rounded-full px-2 py-1.5 transition hover:bg-wash hover:text-danger sm:py-1"
            >
              ⎋
            </button>
          </span>
        )}
      </span>
    </nav>
  );
}
