"use client";

import { useMemo, useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { moodEmoji, moodTone } from "@/lib/mood";

const pad = (n: number) => String(n).padStart(2, "0");
const zhClock = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** 记录时刻 →「今天 15:32 / 昨天 21:04 / 9月15日 08:30」 */
export const zhRecordTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  const clock = zhClock(iso);
  if (diffDays === 0) return { day: "今天", clock };
  if (diffDays === 1) return { day: "昨天", clock };
  const sameYear = d.getFullYear() === now.getFullYear();
  return {
    day: `${sameYear ? "" : d.getFullYear() + "年"}${d.getMonth() + 1}月${d.getDate()}日`,
    clock,
  };
};

const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** 单条动态卡片：原文 + 心情 + AI 识别产物（日程/待办/金额/人物） */
function MomentCard({ m, onDelete }: { m: FeedMoment; onDelete: (m: FeedMoment) => void }) {
  const [confirming, setConfirming] = useState(false);
  const t = zhRecordTime(m.created_at);
  const emoji = moodEmoji(m.mood);
  const intent =
    m.todos.length > 0
      ? { icon: "📋", label: "待办" }
      : m.blocks.length > 0
        ? { icon: "🕒", label: "日程" }
        : m.mood
          ? { icon: "✨", label: "心情" }
          : { icon: "📝", label: "动态" };

  return (
    <article className="group relative flex gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      {/* 头像位：心情 emoji（无心情时用意图图标） */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-xl">
        {m.mood ? emoji : intent.icon}
      </div>

      <div className="min-w-0 flex-1">
        {/* 头部：记录时刻 + 意图标签 */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-400">
            {t.day} <span className="tabular-nums">{t.clock}</span>
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {intent.icon} {intent.label}
          </span>
          {m.source === "voice" && <span title="语音输入">🎙</span>}
          <span className="flex-1" />
          {confirming ? (
            <span className="flex items-center gap-1">
              <button
                onClick={() => onDelete(m)}
                className="rounded bg-rose-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-rose-500"
              >
                确认删除
              </button>
              <button onClick={() => setConfirming(false)} className="px-1 text-[10px] text-slate-400 hover:text-slate-200">
                取消
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              title="删除这条动态（连同识别出的日程/待办）"
              className="hidden rounded px-1 text-xs text-slate-500 hover:text-rose-300 group-hover:block"
            >
              删除
            </button>
          )}
        </div>

        {/* 原文 */}
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-100">
          {m.raw_text}
        </p>

        {/* 心情 */}
        {m.mood && (
          <p className={`mt-1 text-xs ${moodTone(m.mood_score)}`}>
            {moodEmoji(m.mood)} 此刻心情：{m.mood}
          </p>
        )}

        {/* AI 识别产物 */}
        {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0 || m.people.length > 0) && (
          <div className="mt-2.5 space-y-1 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            {m.blocks.map((b) => (
              <p key={b.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                <span>
                  {b.icon} {b.activityName} · {b.title}
                </span>
                <span className="tabular-nums text-slate-400">
                  {zhClock(b.startAt)}–{zhClock(b.endAt)} · {b.durationMin} 分钟
                </span>
              </p>
            ))}
            {m.todos.map((td) => (
              <p key={td.id} className="flex flex-wrap items-center gap-x-2">
                <span>📋 待办：{td.title}</span>
                <span className="text-slate-400">
                  {td.dueAt ? `${zhRecordTime(td.dueAt).day} ${zhClock(td.dueAt)}` : "未定时间"}
                </span>
                {td.status === "done" && <span className="text-emerald-400">已完成</span>}
              </p>
            ))}
            {m.transactions.map((x) => (
              <p key={x.id} className="text-slate-400">
                💰 {x.direction === "out" ? "支出" : "收入"} {yuan(x.amountCents)} · {x.category}
                {x.counterparty ? ` · 对方：${x.counterparty}` : ""}
              </p>
            ))}
            {m.people.length > 0 && (
              <p className="text-slate-400">👥 {m.people.map((p) => p.name).join("、")}</p>
            )}
          </div>
        )}

        {/* 纯心情动态：无任何产物时的轻提示 */}
        {m.blocks.length === 0 && m.todos.length === 0 && m.transactions.length === 0 && m.people.length === 0 && (
          <p className="mt-2 text-[11px] text-slate-600">✨ 仅记录此刻，未生成日程</p>
        )}
      </div>
    </article>
  );
}

/** 动态流：按天分组（今天/昨天/日期分隔线），朋友圈式倒序 */
export default function MomentFeed({ moments, onDelete }: { moments: FeedMoment[]; onDelete: (m: FeedMoment) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, FeedMoment[]>();
    for (const m of moments) {
      const key = zhRecordTime(m.created_at).day;
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    return [...map.entries()];
  }, [moments]);

  if (moments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-600">
        还没有动态 —— 随口说一句今天的事、心情或明天的计划试试
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="sticky top-0 z-10 -mx-1 mb-1 bg-gradient-to-b from-slate-950 via-slate-950/95 to-transparent px-1 pb-1 pt-2 text-xs font-medium text-slate-500">
            — {day} —
          </h3>
          <div className="space-y-2.5">
            {items.map((m) => (
              <MomentCard key={m.id} m={m} onDelete={onDelete} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
