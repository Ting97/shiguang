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
    <nav className="mb-6 flex justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1 text-sm">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-4 py-1.5 transition ${
              active ? "bg-sky-600 font-medium text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
