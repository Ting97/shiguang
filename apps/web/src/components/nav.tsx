"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "工作台" },
  { href: "/calendar", label: "日历" },
  { href: "/categories", label: "分类" },
];

export default function Nav() {
  const pathname = usePathname();
  const [nickname, setNickname] = useState<string | null>(null);
  const [authDisabled, setAuthDisabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <nav className="sticky top-4 z-40 mb-8 flex items-center justify-between gap-2 rounded-full border border-white/10 bg-slate-900/70 p-1 pl-4 text-sm shadow-lg shadow-slate-950/50 backdrop-blur-xl">
      <div className="flex flex-1 justify-center gap-1">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-all duration-200 sm:px-5 sm:text-sm ${
                active
                  ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/invites"
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-all duration-200 sm:px-5 sm:text-sm ${
              pathname === "/invites"
                ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
            }`}
          >
            邀请
          </Link>
        )}
      </div>
      {!authDisabled && nickname && (
        <span className="flex shrink-0 items-center gap-1.5 pr-2 text-xs text-slate-400">
          <Link
            href="/profile"
            title="个人设置"
            className={`rounded-full px-2 py-1 transition hover:bg-white/5 hover:text-sky-300 ${
              pathname === "/profile" ? "text-sky-300" : ""
            }`}
          >
            {nickname}
          </Link>
          <button
            onClick={logout}
            title="退出登录"
            className="rounded-full px-2 py-1 transition hover:bg-white/5 hover:text-rose-300"
          >
            ⎋
          </button>
        </span>
      )}
    </nav>
  );
}
