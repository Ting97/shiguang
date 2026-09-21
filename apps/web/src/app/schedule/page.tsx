"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/nav";
import CalendarPanel from "@/components/calendar-panel";
import TodoBoard from "@/components/todo-board";
import ActivityPanel from "@/components/activity-panel";
import TodoLogo from "@/components/todo-logo";

/**
 * 日程模块：日历（时间统计四视图）+ TODO（待办管理）+ 分类（活动分类管理）。
 * 原「日历」/「分类」独立页迁移至此；?tab=todo|categories 可直达子页（旧路由跳转用）。
 */

type Tab = "calendar" | "todo" | "categories";
const TABS: [Tab, string][] = [
  ["calendar", "📅 日历"],
  ["todo", "TODO"],
  ["categories", "🏷️ 分类"],
];

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("calendar");
  // 首次激活才挂载（避免首屏三份请求）；挂过后保留状态（日历锚点/TODO 视图不被切换重置）
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({ calendar: true, todo: false, categories: false });

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "todo" || t === "categories") setTab(t);
  }, []);

  useEffect(() => {
    setMounted((m) => (m[tab] ? m : { ...m, [tab]: true }));
  }, [tab]);

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
        <Nav />

        {/* 模块头：标题 + 三个子页切换（移动端全宽三等分，PC 居中胶囊） */}
        <div className="glass mb-5 flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-gradient text-xl font-bold tracking-wide">
            日程
            <span className="ml-2 align-middle text-xs font-normal tracking-normal text-ink-dim">日历 · TODO · 分类</span>
          </h1>
          <div className="flex rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs sm:w-auto">
            {TABS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 transition-all duration-200 sm:flex-none sm:px-4 sm:py-1 sm:text-[13px] ${
                  tab === v
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-ink-mute hover:bg-wash hover:text-ink"
                }`}
              >
                {v === "todo" && <TodoLogo size={15} onGradient={tab === v} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {mounted.calendar && (
          <div className={tab === "calendar" ? "" : "hidden"}>
            <CalendarPanel />
          </div>
        )}
        {mounted.todo && (
          <div className={tab === "todo" ? "" : "hidden"}>
            <TodoBoard />
          </div>
        )}
        {mounted.categories && (
          <div className={tab === "categories" ? "" : "hidden"}>
            <ActivityPanel />
          </div>
        )}
      </div>
    </main>
  );
}
