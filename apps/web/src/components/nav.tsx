"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "工作台" },
  { href: "/calendar", label: "日历" },
  { href: "/categories", label: "分类" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-4 z-40 mb-8 flex justify-center gap-1 rounded-full border border-white/10 bg-slate-900/70 p-1 text-sm shadow-lg shadow-slate-950/50 backdrop-blur-xl">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-full px-5 py-1.5 transition-all duration-200 ${
              active
                ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
