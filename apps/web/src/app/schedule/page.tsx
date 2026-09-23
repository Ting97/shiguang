"use client";

import { useEffect, useState } from "react";
import CalendarPanel from "@/components/calendar-panel";
import TodoBoard from "@/components/todo-board";
import ActivityPanel from "@/components/activity-panel";
import TodoLogo from "@/components/todo-logo";
import SubNav from "@/components/sub-nav";

/**
 * 日程模块：日历（时间统计四视图）+ TODO（待办管理）+ 分类（活动分类管理）。
 * 原「日历」/「分类」独立页迁移至此；?tab=todo|categories 可直达子页（旧路由跳转用）。
 */

type Tab = "calendar" | "todo" | "categories";
const TABS: [Tab, string][] = [
  ["calendar", "📅 日历"],
  ["todo", "todo"],
  ["categories", "🏷️ 分类"],
];

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("calendar");
  // 首次激活才挂载（避免首屏三份请求）；挂过后保留状态（日历锚点/TODO 视图不被切换重置）
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({ calendar: true, todo: false, categories: false });
  // ?date=YYYY-MM-DD 直达某天（动态流冲突提示「去调整」跳转用）；非法值回落今天
  const [initialDate, setInitialDate] = useState<string | undefined>();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t === "todo" || t === "categories") setTab(t);
    const d = sp.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setInitialDate(d);
  }, []);

  useEffect(() => {
    setMounted((m) => (m[tab] ? m : { ...m, [tab]: true }));
  }, [tab]);

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">

        {/* 模块抬头：与动态/财务统一的居中 hero 样式；子页切换居中悬挂在副标题下（FR-4.3 公共 SubNav） */}
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">日程</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">时间去了哪、todo 推进如何 —— 日历 · 看板 · 分类</p>
          <SubNav
            className="mt-3"
            ariaLabel="日程子导航"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            items={TABS.map(([v, label]) => ({
              key: v,
              label,
              icon: v === "todo" ? <TodoLogo size={15} onGradient={tab === v} /> : undefined,
            }))}
          />
        </header>

        {mounted.calendar && (
          <div className={tab === "calendar" ? "" : "hidden"}>
            <CalendarPanel initialAnchor={initialDate} />
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
