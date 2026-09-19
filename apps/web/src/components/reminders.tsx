"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReminderItem } from "@/lib/reminders";
import { todayStr } from "@/lib/date";

/**
 * 工作台提醒横幅（W12）：生日/纪念日 + 到期待办
 * - 条目可点：联系人 → TA 档案；待办 → 锚到待办区
 * - 「知道了」当天不再展示（localStorage 按日期记录，次日自动回来）
 */
export default function Reminders({ items }: { items: ReminderItem[] }) {
  const [dismissed, setDismissed] = useState(true); // 默认不展示，读到 localStorage 后纠正，避免闪烁

  useEffect(() => {
    setDismissed(window.localStorage.getItem("shiguang_reminders_dismissed") === todayStr());
  }, []);

  if (items.length === 0 || dismissed) return null;

  return (
    <section
      aria-label="提醒"
      className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-warn"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-medium text-warn">🔔 提醒</span>
        <span className="flex-1" />
        <button
          onClick={() => {
            window.localStorage.setItem("shiguang_reminders_dismissed", todayStr());
            setDismissed(true);
          }}
          title="今天不再展示"
          className="rounded px-1.5 py-0.5 text-[11px] text-warn/70 transition hover:bg-amber-500/15 hover:text-warn"
        >
          知道了 ✕
        </button>
      </div>
      <ul className="mt-1.5 space-y-1">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-1.5 leading-relaxed">
            <span className="mt-px shrink-0">
              {it.kind === "birthday" ? "🎂" : it.kind === "anniversary" ? "💞" : it.overdue ? "⏰" : "📋"}
            </span>
            {it.contactId ? (
              <Link
                href={`/contacts/${it.contactId}`}
                className={it.overdue ? "text-danger underline-offset-2 hover:underline" : "underline-offset-2 hover:underline"}
              >
                {it.label}
              </Link>
            ) : (
              <a href="#todos" className={it.overdue ? "text-danger underline-offset-2 hover:underline" : "underline-offset-2 hover:underline"}>
                {it.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
