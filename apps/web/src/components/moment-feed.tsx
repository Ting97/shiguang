"use client";

import { useState } from "react";
import type { Activity, FeedMoment } from "@/lib/types";
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

const TX_CATEGORIES = ["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "其他"];
const COMMON_MOODS = ["开心", "满足", "兴奋", "放松", "平静", "疲惫", "焦虑", "烦躁", "难过", "生气"];

/** 用原块日期 + 新的 HH:MM 组装 ISO（保持本地时区与原日期） */
function combineHM(originalIso: string, hm: string): string {
  const d = new Date(originalIso);
  const [h, m] = hm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const isoToLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localInputToIso = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "操作失败");
  return j;
}

interface Props {
  moments: FeedMoment[];
  activities: Activity[];
  onRefresh: () => Promise<void>;
  notify: (ok: boolean, text: string) => void;
}

/** 行内小操作按钮（编辑/删除），悬停显示 */
function RowAction({ onEdit, onDelete, editTitle = "修改", delTitle = "删除" }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editTitle?: string;
  delTitle?: string;
}) {
  return (
    <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
      {onEdit && (
        <button
          onClick={onEdit}
          title={editTitle}
          className="rounded px-1 py-0.5 text-[11px] text-slate-500 hover:text-sky-300"
        >
          ✏️
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title={delTitle}
          className="rounded px-1 py-0.5 text-[11px] text-slate-500 hover:text-rose-300"
        >
          🗑
        </button>
      )}
    </span>
  );
}

/** 单条动态卡片：原文 + 心情 + AI 识别产物（日程/待办/金额/人物，均可修改/删除） */
function MomentCard({ m, activities, onRefresh, notify }: Props & { m: FeedMoment }) {
  const [confirming, setConfirming] = useState(false);
  const [moodPicker, setMoodPicker] = useState(false);
  const [editBlock, setEditBlock] = useState<{ id: string; title: string; start: string; end: string; activityId: string } | null>(null);
  const [editTodo, setEditTodo] = useState<{ id: string; title: string; due: string; activityId: string } | null>(null);
  const [editTx, setEditTx] = useState<{ id: string; direction: string; amount: string; category: string; counterparty: string } | null>(null);

  const emoji = moodEmoji(m.mood);
  const intent =
    m.todos.length > 0
      ? { icon: "📋", label: "待办" }
      : m.blocks.length > 0
        ? { icon: "🕒", label: "日程" }
        : m.mood
          ? { icon: "✨", label: "心情" }
          : { icon: "📝", label: "动态" };

  const run = async (fn: () => Promise<string>) => {
    try {
      notify(true, await fn());
      await onRefresh();
    } catch (e) {
      notify(false, e instanceof Error ? e.message : String(e));
    }
  };

  const del = (message: string, fn: () => Promise<unknown>) =>
    window.confirm(message) ? run(async () => (await fn(), "🗑 已删除")) : undefined;

  return (
    <article className="glass glass-hover group relative mt-0 flex min-w-0 flex-1 gap-3 rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5">
      {/* 头像位：心情 emoji（无心情时用意图图标） */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-xl">
        {m.mood ? emoji : intent.icon}
      </div>

      <div className="min-w-0 flex-1">
        {/* 头部：意图标签 + 整条删除（记录时间在卡片外的时间线旁） */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {intent.icon} {intent.label}
          </span>
          {m.source === "voice" && <span title="语音输入">🎙</span>}
          <span className="flex-1" />
          {confirming ? (
            <span className="flex items-center gap-1">
              <button
                onClick={() =>
                  run(async () => {
                    await api(`/api/feed/${m.id}`, "DELETE");
                    return "🗑 已删除这条动态及其识别结果";
                  }).then(() => setConfirming(false))
                }
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

        {/* 心情：可改可删 */}
        {m.mood || moodPicker ? (
          <div className="mt-1 text-xs">
            {moodPicker ? (
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                {COMMON_MOODS.map((w) => (
                  <button
                    key={w}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/feed/${m.id}`, "PATCH", { mood: w });
                        return `${moodEmoji(w)} 心情已改为「${w}」`;
                      }).then(() => setMoodPicker(false))
                    }
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      m.mood === w ? "bg-sky-600 text-white" : "bg-slate-700/60 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {moodEmoji(w)} {w}
                  </button>
                ))}
                <button
                  onClick={() =>
                    run(async () => {
                      await api(`/api/feed/${m.id}`, "PATCH", { mood: null });
                      return "已清除心情";
                    }).then(() => setMoodPicker(false))
                  }
                  className="rounded-full px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/20"
                >
                  清除
                </button>
                <button onClick={() => setMoodPicker(false)} className="ml-auto px-1 text-[11px] text-slate-500">
                  取消
                </button>
              </div>
            ) : (
              <p className={`group/mood flex items-center gap-1.5 ${moodTone(m.mood_score)}`}>
                <span>{moodEmoji(m.mood)} 此刻心情：{m.mood}</span>
                <button
                  onClick={() => setMoodPicker(true)}
                  className="hidden text-[11px] text-slate-500 hover:text-sky-300 group-hover/mood:inline"
                >
                  改
                </button>
              </p>
            )}
          </div>
        ) : null}

        {/* AI 识别产物 */}
        {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0 || m.people.length > 0) && (
          <div className="mt-2.5 space-y-1 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            {/* ---- 日程块 ---- */}
            {m.blocks.map((b) =>
              editBlock?.id === b.id ? (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-slate-800/60 p-2">
                  <input
                    value={editBlock.title}
                    onChange={(e) => setEditBlock({ ...editBlock, title: e.target.value })}
                    className="min-w-28 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="标题"
                  />
                  <input
                    type="time"
                    value={editBlock.start}
                    onChange={(e) => setEditBlock({ ...editBlock, start: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                  />
                  <span className="text-slate-500">至</span>
                  <input
                    type="time"
                    value={editBlock.end}
                    onChange={(e) => setEditBlock({ ...editBlock, end: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                  />
                  <select
                    value={editBlock.activityId}
                    onChange={(e) => setEditBlock({ ...editBlock, activityId: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                  <span className="flex gap-1">
                    <button onClick={() => setEditBlock(null)} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          if (editBlock.end <= editBlock.start) throw new Error("结束时间必须晚于开始时间");
                          await api(`/api/blocks/${b.id}`, "PATCH", {
                            title: editBlock.title.trim() || b.title,
                            startAt: combineHM(b.startAt, editBlock.start),
                            endAt: combineHM(b.endAt, editBlock.end),
                            activityId: editBlock.activityId,
                          });
                          setEditBlock(null);
                          return "💾 日程已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={b.id} className="group/row flex items-center gap-x-2 gap-y-0.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="truncate">
                    {b.icon} {b.activityName} · {b.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {zhClock(b.startAt)}–{zhClock(b.endAt)} · {b.durationMin} 分钟
                  </span>
                  <RowAction
                    onEdit={() =>
                      setEditBlock({
                        id: b.id,
                        title: b.title,
                        start: zhClock(b.startAt),
                        end: zhClock(b.endAt),
                        activityId: activities.some((a) => a.id === b.activityId) ? b.activityId : activities[0]?.id ?? "",
                      })
                    }
                    onDelete={() =>
                      del(`删除这条日程？\n「${b.title}」 ${zhClock(b.startAt)}–${zhClock(b.endAt)}`, () =>
                        api(`/api/blocks/${b.id}`, "DELETE"))
                    }
                  />
                </p>
              ),
            )}

            {/* ---- 待办 ---- */}
            {m.todos.map((td) =>
              editTodo?.id === td.id ? (
                <div key={td.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-slate-800/60 p-2">
                  <input
                    value={editTodo.title}
                    onChange={(e) => setEditTodo({ ...editTodo, title: e.target.value })}
                    className="min-w-28 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="标题"
                  />
                  <input
                    type="datetime-local"
                    value={editTodo.due}
                    onChange={(e) => setEditTodo({ ...editTodo, due: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                  />
                  <select
                    value={editTodo.activityId}
                    onChange={(e) => setEditTodo({ ...editTodo, activityId: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                  <span className="flex gap-1">
                    <button onClick={() => setEditTodo(null)} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          if (!editTodo.title.trim()) throw new Error("标题不能为空");
                          await api(`/api/todos/${td.id}`, "PATCH", {
                            title: editTodo.title.trim(),
                            dueAt: localInputToIso(editTodo.due),
                            activityId: editTodo.activityId,
                          });
                          setEditTodo(null);
                          return "💾 待办已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={td.id} className="group/row flex items-center gap-x-2">
                  <span className="truncate">📋 待办：{td.title}</span>
                  <span className="shrink-0 text-slate-400">
                    {td.dueAt ? `${zhRecordTime(td.dueAt).day} ${zhClock(td.dueAt)}` : "未定时间"}
                  </span>
                  {td.status === "done" && <span className="shrink-0 text-emerald-400">已完成</span>}
                  <RowAction
                    onEdit={() =>
                      setEditTodo({
                        id: td.id,
                        title: td.title,
                        due: isoToLocalInput(td.dueAt),
                        activityId: activities.some((a) => a.id === td.activityId) ? td.activityId! : activities[0]?.id ?? "",
                      })
                    }
                    onDelete={() => del(`删除这条待办？\n「${td.title}」`, () => api(`/api/todos/${td.id}`, "DELETE"))}
                  />
                </p>
              ),
            )}

            {/* ---- 金额流水 ---- */}
            {m.transactions.map((x) =>
              editTx?.id === x.id ? (
                <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-slate-800/60 p-2">
                  <select
                    value={editTx.direction}
                    onChange={(e) => setEditTx({ ...editTx, direction: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    <option value="out">支出</option>
                    <option value="in">收入</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editTx.amount}
                    onChange={(e) => setEditTx({ ...editTx, amount: e.target.value })}
                    className="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                    placeholder="金额(元)"
                  />
                  <select
                    value={editTx.category}
                    onChange={(e) => setEditTx({ ...editTx, category: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {TX_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    value={editTx.counterparty}
                    onChange={(e) => setEditTx({ ...editTx, counterparty: e.target.value })}
                    className="w-24 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="对方(可空)"
                  />
                  <span className="flex gap-1">
                    <button onClick={() => setEditTx(null)} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const cents = Math.round(parseFloat(editTx.amount) * 100);
                          if (!Number.isFinite(cents) || cents <= 0) throw new Error("金额必须大于 0");
                          await api(`/api/transactions/${x.id}`, "PATCH", {
                            direction: editTx.direction,
                            amountCents: cents,
                            category: editTx.category,
                            counterparty: editTx.counterparty,
                          });
                          setEditTx(null);
                          return "💾 金额已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={x.id} className="group/row flex items-center gap-x-2 text-slate-400">
                  <span>
                    💰 {x.direction === "out" ? "支出" : "收入"} {yuan(x.amountCents)} · {x.category}
                    {x.counterparty ? ` · 对方：${x.counterparty}` : ""}
                  </span>
                  <RowAction
                    onEdit={() =>
                      setEditTx({
                        id: x.id,
                        direction: x.direction,
                        amount: String(x.amountCents / 100),
                        category: TX_CATEGORIES.includes(x.category) ? x.category : "其他",
                        counterparty: x.counterparty ?? "",
                      })
                    }
                    onDelete={() => del(`删除这笔金额记录？（${x.direction === "out" ? "支出" : "收入"} ${yuan(x.amountCents)}）`, () =>
                      api(`/api/transactions/${x.id}`, "DELETE"))}
                  />
                </p>
              ),
            )}

            {/* ---- 人物 ---- */}
            {m.people.length > 0 && (
              <p className="group/row flex items-center gap-x-2 text-slate-400">
                <span>👥 {m.people.map((p) => p.name).join("、")}</span>
                <RowAction
                  onDelete={() =>
                    del(`移除人物关联？（不影响联系人档案）\n「${m.people.map((p) => p.name).join("、")}」`, () =>
                      Promise.all(m.people.map((p) => api(`/api/interactions/${p.interactionId}`, "DELETE"))).then(() => undefined))
                  }
                />
              </p>
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

/** 动态流：左侧时间线，记录时间放在线右侧、卡片外；今天的动态只显示时刻 */
export default function MomentFeed(props: Props) {
  if (props.moments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-600">
        还没有动态 —— 随口说一句今天的事、心情或明天的计划试试
      </p>
    );
  }

  return (
    <div className="relative space-y-3">
      {/* 时间线：贯穿左侧的晨光竖线 */}
      <div className="absolute bottom-4 left-[11px] top-4 w-px bg-gradient-to-b from-sky-500/50 via-indigo-500/25 to-transparent" />
      {props.moments.map((m) => {
        const t = zhRecordTime(m.created_at);
        return (
          <div key={m.id} className="relative flex items-start gap-2.5">
            <span className="absolute left-[6px] top-8 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-sky-400 to-indigo-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
            {/* 记录时间：时间线右侧、卡片外（历史动态附日期） */}
            <div className="ml-5 w-12 shrink-0 pt-4 text-right leading-tight">
              {t.day !== "今天" && <div className="text-[10px] text-slate-600">{t.day}</div>}
              <div className="text-xs tabular-nums text-slate-400">{t.clock}</div>
            </div>
            <MomentCard m={m} {...props} />
          </div>
        );
      })}
    </div>
  );
}
