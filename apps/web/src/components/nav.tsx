"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "./theme-toggle";

const LINKS = [
  { href: "/", label: "动态" },
  { href: "/spaces", label: "目标" },
  { href: "/schedule", label: "日程" },
  { href: "/contacts", label: "人际" },
  { href: "/finance", label: "财务" },
];

export default function Nav() {
  const pathname = usePathname();
  const [nickname, setNickname] = useState<string | null>(null);
  const [authDisabled, setAuthDisabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (r.status === 401) {
        location.href = "/login"; // 会话失效（异地退出/过期）→ 回登录页
        return;
      }
      r.json().then((j) => {
        setNickname(j.nickname ?? "我");
        setAuthDisabled(Boolean(j.authDisabled));
      });
    });
  }, []);

  // 移动端横滑时把当前激活项滚入可视区中央（否则访问靠后的模块看不出当前在哪）
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-path="${pathname}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  const linkCls = (active: boolean) =>
    // 固定 min-width + 居中：激活态 font-medium 变宽时占位宽度不变（消除切换跳动）
    `shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-center text-[13px] transition-all duration-200 min-w-[3.5rem] sm:min-w-[4.5rem] sm:px-5 sm:py-1.5 sm:text-sm ${
      active
        ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
        : "text-ink-mute hover:bg-wash hover:text-ink"
    }`;

  return (
    <nav className="sticky top-0 z-40 mb-8 flex items-center justify-between gap-2 rounded-b-2xl border border-t-0 border-line-soft bg-surface/80 p-1 pl-3 text-sm shadow-lg shadow-scrim/50 backdrop-blur-xl safe-top">
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
