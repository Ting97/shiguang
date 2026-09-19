"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "动态" },
  { href: "/calendar", label: "日历" },
  { href: "/contacts", label: "人际" },
  { href: "/finance", label: "财务" },
  { href: "/categories", label: "分类" },
];

export default function Nav() {
  const pathname = usePathname();
  const [nickname, setNickname] = useState<string | null>(null);
  const [authDisabled, setAuthDisabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
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
        setIsAdmin(Boolean(j.isAdmin));
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
    `shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[13px] transition-all duration-200 sm:px-5 sm:py-1.5 sm:text-sm ${
      active
        ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
        : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
    }`;

  return (
    <nav className="sticky top-0 z-40 mb-8 flex items-center justify-between gap-2 rounded-b-2xl border border-t-0 border-white/10 bg-slate-900/80 p-1 pl-3 text-sm shadow-lg shadow-slate-950/50 backdrop-blur-xl safe-top">
      <div ref={scrollRef} className="scrollbar-none flex min-w-0 flex-1 justify-start gap-1 overflow-x-auto sm:justify-center">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link key={l.href} href={l.href} data-path={l.href} className={linkCls(active)}>
              {l.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link href="/invites" data-path="/invites" className={linkCls(pathname === "/invites")}>
            邀请
          </Link>
        )}
      </div>
      {!authDisabled && nickname && (
        <span className="flex shrink-0 items-center gap-1.5 pr-2 text-xs text-slate-400">
          <Link
            href="/profile"
            title="个人设置"
            className={`max-w-[4.5rem] truncate rounded-full px-2 py-1.5 transition hover:bg-white/5 hover:text-sky-300 sm:max-w-none sm:py-1 ${
              pathname === "/profile" ? "text-sky-300" : ""
            }`}
          >
            {nickname}
          </Link>
          <button
            onClick={logout}
            title="退出登录"
            className="rounded-full px-2 py-1.5 transition hover:bg-white/5 hover:text-rose-300 sm:py-1"
          >
            ⎋
          </button>
        </span>
      )}
    </nav>
  );
}
