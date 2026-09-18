"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/nav";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import MomentFeed from "@/components/moment-feed";
import Reminders from "@/components/reminders";
import { pickReminders, type ReminderContact, type ReminderItem, type ReminderTodo } from "@/lib/reminders";
import BlockDraftForm, { type BlockDraftValue } from "@/components/block-draft-form";
import { parseYmd, todayStr, zhDuration } from "@/lib/date";
import { moodEmoji } from "@/lib/mood";
import type { Activity, Block, FeedMoment } from "@/lib/types";

interface Todo {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  done_at: string | null;
  activity_id: string | null;
  activity_name: string | null;
  icon: string | null;
  color: string | null;
}
interface BlockDraft {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}
interface TodoDraft {
  id: string;
  title: string;
  due: string; // datetime-local 值 YYYY-MM-DDTHH:MM，空串=无时间
  activityId: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const zhDateTime = (iso: string | null) => {
  if (!iso) return "未定时间";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = `${sameYear ? "" : d.getFullYear() + "年"}${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const zhTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dueTag = (iso: string | null) => {
  if (!iso) return { text: "无时间", cls: "text-slate-500" };
  const d = new Date(iso);
  if (d < new Date()) return { text: "已过期", cls: "text-rose-400" };
  // 按日历天比对（当天晚些时候是"今天"而非"明天"）
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(d) - dayStart(new Date())) / 86400_000);
  if (days === 0) return { text: "今天", cls: "text-amber-300" };
  if (days === 1) return { text: "明天", cls: "text-sky-300" };
  return { text: `${days} 天后`, cls: "text-slate-400" };
};

export default function Home() {
  const [text, setText] = useState("");
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [doneToday, setDoneToday] = useState<Todo[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [editingTodo, setEditingTodo] = useState<TodoDraft | null>(null);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [todayKcal, setTodayKcal] = useState(0);
  const [listDraft, setListDraft] = useState<BlockDraftValue | null>(null);
  const [listSaving, setListSaving] = useState(false);
  const listFormRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminderItems, setReminderItems] = useState<ReminderItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const [todayRes, feedRes, reminderRes] = await Promise.all([
      fetch("/api/today"),
      fetch("/api/feed?limit=50"),
      fetch("/api/reminders"),
    ]);
    const j = await todayRes.json();
    setTodos(j.todos ?? []);
    setDoneToday(j.doneToday ?? []);
    setBlocks(j.blocks ?? []);
    setActivities(j.activities ?? []);
    setTodayKcal(j.todayKcal ?? 0);
    const f = await feedRes.json();
    setMoments(f.moments ?? []);
    // W12 提醒横幅：接口失败不打扰主流程
    try {
      const rj = await reminderRes.json();
      setReminderItems(pickReminders((rj.contacts ?? []) as ReminderContact[], (rj.todos ?? []) as ReminderTodo[]));
    } catch {
      setReminderItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!msg) return;
    // 成功提示短展示；失败/警示保留更久，避免用户错过原因
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const moodTag = j.result.mood.label ? ` ${moodEmoji(j.result.mood.label)}${j.result.mood.label}` : "";
      // 五域命中汇总
      const hits: string[] = [];
      if (j.kind === "todo" || j.result.intent === "todo") hits.push("📋 待办");
      else if (j.result.scheduleApplicable) hits.push("🕒 日程");
      if (j.result.finance?.hasAmount) hits.push("💰 收支");
      if (j.result.mood?.label) hits.push(`${moodEmoji(j.result.mood.label)} 心情`);
      if (j.result.diet?.applicable) hits.push(`🍽 饮食`);
      const pending = (j.pendingDomains ?? []).length > 0 ? ` · ❓ ${(j.pendingDomains as string[]).length} 项待确认` : "";
      const summary = `已识别：${hits.length ? hits.join(" + ") : "纯动态"}${pending}`;
      if (j.conflict) {
        // AI 识别出日程但与已有时间块冲突：动态已保存，仅未登记时间轴
        setMsg({
          ok: false,
          text: `⚠️ ${summary}，但识别的时间与「${j.conflict.title}」重叠，未登记时间轴 —— 可在下方时间轴补录或调整原日程`,
        });
      } else if (j.kind === "todo") {
        setMsg({ ok: true, text: `📋 ${summary} · ${zhDateTime(j.todo.due_at)} ${j.todo.title}${moodTag}` });
          } else if (j.kind === "moment") {
            setMsg({
              ok: true,
              text: j.conflictMessage
                ? `✨ ${summary}（未生成日程：${j.conflictMessage}）`
                : `✨ ${summary}${moodTag}`,
            });
      } else {
        setMsg({ ok: true, text: `✅ ${summary} · ${j.result.time.durationMin} 分钟 · ${j.block.title}${moodTag}` });
      }
      setText("");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `解析失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function toggleDone(t: Todo) {
    // 乐观更新
    setTodos((list) => list.filter((x) => x.id !== t.id));
    setDoneToday((list) => [{ ...t, status: "done" }, ...list]);
    const r = await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    if (!r.ok) {
      await load(); // 失败回滚视图
      setMsg({ ok: false, text: "完成操作失败，已恢复" });
      return;
    }
    setMsg({ ok: true, text: `🎉 完成「${t.title}」，已记入今日日程` });
    await load();
  }

  function startEdit(b: Block) {
    setEditing({
      id: b.id,
      title: b.title,
      start: zhTime(b.start_at),
      end: zhTime(b.end_at),
      activityId: b.activity_id,
    });
  }

  /** 用原块日期 + 新的 HH:MM 组装 ISO（保持本地时区） */
  function combineHM(originalIso: string, hm: string): string {
    const d = new Date(originalIso);
    const [h, m] = hm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  async function saveEdit() {
    if (!editing) return;
    if (editing.end <= editing.start) {
      setMsg({ ok: false, text: "结束时间必须晚于开始时间" });
      return;
    }
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    const r = await fetch(`/api/blocks/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editing.title.trim() || b.title,
        startAt: combineHM(b.start_at, editing.start),
        endAt: combineHM(b.end_at, editing.end),
        activityId: editing.activityId,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? "保存失败" });
      return;
    }
    setEditing(null);
    setMsg({ ok: true, text: "💾 日程已更新" });
    await load();
  }

  async function removeBlock(b: Block) {
    if (!window.confirm(`删除这条日程？\n「${b.title}」 ${zhTime(b.start_at)}–${zhTime(b.end_at)}`)) return;
    const r = await fetch(`/api/blocks/${b.id}`, { method: "DELETE" });
    if (!r.ok) {
      setMsg({ ok: false, text: "删除失败" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除「${b.title}」` });
    await load();
  }

  // ---------- 待办编辑/删除 ----------

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

  function startTodoEdit(t: Todo) {
    setEditingTodo({ id: t.id, title: t.title, due: isoToLocalInput(t.due_at), activityId: t.activity_id ?? "other" });
  }

  async function saveTodoEdit() {
    if (!editingTodo || !editingTodo.title.trim()) {
      setMsg({ ok: false, text: "标题不能为空" });
      return;
    }
    const r = await fetch(`/api/todos/${editingTodo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editingTodo.title.trim(),
        dueAt: localInputToIso(editingTodo.due),
        activityId: editingTodo.activityId,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? "保存失败" });
      return;
    }
    setEditingTodo(null);
    setMsg({ ok: true, text: "💾 待办已更新" });
    await load();
  }

  async function removeTodo(t: Todo) {
    if (!window.confirm(`删除这条待办？\n「${t.title}」`)) return;
    const r = await fetch(`/api/todos/${t.id}`, { method: "DELETE" });
    if (!r.ok) {
      setMsg({ ok: false, text: "删除失败" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除待办「${t.title}」` });
    await load();
  }

  async function restoreTodo(t: Todo) {
    setDoneToday((list) => list.filter((x) => x.id !== t.id)); // 乐观更新
    const r = await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ undone: true }),
    });
    if (!r.ok) {
      await load();
      setMsg({ ok: false, text: "恢复失败，已还原" });
      return;
    }
    setMsg({ ok: true, text: `↩️ 「${t.title}」已恢复为未完成（对应日程已移除）` });
    await load();
  }

  /** 时间轴缺口补录 */
  async function createBlock(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    const r = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ ok: false, text: j.error ?? "补录失败" });
      return false;
    }
    setMsg({ ok: true, text: `✍️ 已补录：${payload.title}` });
    await load();
    return true;
  }

  const todayByActivity = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.activity_id] = (acc[b.activity_id] ?? 0) + b.duration_min;
    return acc;
  }, {});

  /** 时间轴上点击时间块 → 切到列表视图并打开编辑器 */
  function editBlockFromTimeline(b: Block) {
    setView("list");
    startEdit(b);
  }

  // ---------- 列表视图新增日程 ----------

  const hmLocal = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const minOfDayLocal = (iso: string) => {
    const day = parseYmd(todayStr());
    return Math.max(0, Math.min(1440, Math.floor((new Date(iso).getTime() - day.getTime()) / 60_000)));
  };

  /** 从当前小时起找第一个空闲的整点 1 小时槽位（都占用则用当前小时，由冲突提示兜底） */
  function nextFreeSlot(): BlockDraftValue {
    const now = new Date();
    const curH = now.getHours();
    const spans = blocks.map((b) => [minOfDayLocal(b.start_at), minOfDayLocal(b.end_at)]);
    for (let h = curH; h < 24; h++) {
      if (!spans.some(([s, e]) => h * 60 < e && (h + 1) * 60 > s)) {
        return { title: "", start: hmLocal(h * 60), end: hmLocal((h + 1) * 60), activityId: "other" };
      }
    }
    return { title: "", start: hmLocal(curH * 60), end: hmLocal(Math.min(24, curH + 1) * 60), activityId: "other" };
  }

  useEffect(() => {
    if (listDraft) listFormRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [listDraft]);

  async function submitListDraft() {
    if (!listDraft || !listDraft.title.trim() || listSaving) return;
    setListSaving(true);
    const [sh, sm] = listDraft.start.split(":").map(Number);
    const [eh, em] = listDraft.end.split(":").map(Number);
    const day = parseYmd(todayStr());
    const ok = await createBlock({
      title: listDraft.title.trim(),
      startAt: new Date(day.getTime() + (sh * 60 + sm) * 60_000).toISOString(),
      endAt: new Date(day.getTime() + (eh * 60 + em) * 60_000).toISOString(),
      activityId: listDraft.activityId,
    });
    setListSaving(false);
    if (ok) setListDraft(null);
  }

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-5 sm:py-8">
        <Nav />
        <header className="mb-5 text-center sm:mb-7">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光复利
            <span className="ml-2 align-middle text-sm font-normal tracking-normal text-slate-500">动态</span>
          </h1>
          <p className="mt-2 text-xs text-slate-500">
            随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来待办
          </p>
        </header>

        {/* W12 提醒横幅：生日/纪念日/到期待办 */}
        <Reminders items={reminderItems} />

        {/* 输入区 */}
        <section className="mb-3">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder='记录此刻…（试试"刚跑完步40分钟，心情不错"、"有点累"、"明天下午三点看牙"）'
            className="input-glow w-full resize-none rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm outline-none placeholder:text-slate-600"
          />
          <div className="mt-2 flex items-center justify-end sm:justify-between">
            <span className="hidden text-[11px] text-slate-600 sm:block">Enter 发布 · Shift+Enter 换行</span>
            <button
              onClick={submit}
              disabled={busy || !text.trim()}
              className="btn-primary rounded-xl px-7 py-2 text-sm font-medium"
            >
              {busy ? "识别中…" : "发布"}
            </button>
          </div>
        </section>
        {msg && (
          <div
            className={`mb-5 rounded-lg border px-3 py-2 text-xs ${
              msg.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 动态流：每条记录都是一条动态（记录时刻 + AI 识别结果，均可修改/删除） */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            🌱 我的动态 <span className="ml-1 text-xs font-normal text-slate-500">{moments.length} 条 · 悬停卡片可修正识别结果</span>
          </h2>
          <MomentFeed
            moments={moments}
            activities={activities}
            onRefresh={load}
            notify={(ok, text) => setMsg({ ok, text })}
          />
        </section>

        {/* 待办列表 */}
        <section id="todos" className="glass mb-6 rounded-2xl p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            📋 待办 <span className="ml-1 text-xs text-slate-500">{todos.length} 项 · 点击圆圈完成</span>
          </h2>
          {todos.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-600">暂无待办 —— 说句带"明天/待会儿"的话试试</p>
          )}
          <ul className="space-y-1">
            {todos.map((t) => {
              const tag = dueTag(t.due_at);
              return editingTodo?.id === t.id ? (
                /* ---- 待办行内编辑器 ---- */
                <li key={t.id} className="rounded-lg border border-sky-500/40 bg-slate-800/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editingTodo.title}
                      onChange={(e) => setEditingTodo({ ...editingTodo, title: e.target.value })}
                      className="min-w-32 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                      placeholder="标题"
                    />
                    <input
                      type="datetime-local"
                      value={editingTodo.due}
                      onChange={(e) => setEditingTodo({ ...editingTodo, due: e.target.value })}
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <select
                      value={editingTodo.activityId}
                      onChange={(e) => setEditingTodo({ ...editingTodo, activityId: e.target.value })}
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                    >
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.icon} {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setEditingTodo(null)}
                      className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-700"
                    >
                      取消
                    </button>
                    <button
                      onClick={saveTodoEdit}
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </div>
                </li>
              ) : (
                /* ---- 常规待办行 ---- */
                <li key={t.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800/60">
                  <button
                    onClick={() => toggleDone(t)}
                    title="点击标记完成"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-500 text-transparent transition group-hover:border-sky-400 group-hover:text-sky-400/60"
                  >
                    ✓
                  </button>
                  <span className="text-base">{t.icon ?? "📌"}</span>
                  <span className="flex-1 truncate text-sm">{t.title}</span>
                  <span className={`shrink-0 text-xs ${tag.cls}`}>{tag.text}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{zhDateTime(t.due_at)}</span>
                  <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={() => startTodoEdit(t)}
                      title="修改"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeTodo(t)}
                      title="删除"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300"
                    >
                      🗑
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {doneToday.length > 0 && (
            <details className="mt-3 border-t border-slate-800 pt-3">
              <summary className="cursor-pointer text-xs text-slate-500">
                今日已完成 {doneToday.length} 项（可恢复 / 修改 / 删除）
              </summary>
              <ul className="mt-2 space-y-1">
                {doneToday.map((t) =>
                  editingTodo?.id === t.id ? (
                    <li key={t.id} className="rounded-lg border border-sky-500/40 bg-slate-800/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editingTodo.title}
                          onChange={(e) => setEditingTodo({ ...editingTodo, title: e.target.value })}
                          className="min-w-32 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                          placeholder="标题"
                        />
                        <input
                          type="datetime-local"
                          value={editingTodo.due}
                          onChange={(e) => setEditingTodo({ ...editingTodo, due: e.target.value })}
                          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                        />
                        <select
                          value={editingTodo.activityId}
                          onChange={(e) => setEditingTodo({ ...editingTodo, activityId: e.target.value })}
                          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                        >
                          {activities.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.icon} {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => setEditingTodo(null)}
                          className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-700"
                        >
                          取消
                        </button>
                        <button
                          onClick={saveTodoEdit}
                          className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500"
                        >
                          保存
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={t.id} className="group flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-slate-800/60">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-[9px] text-white">✓</span>
                      <span className="flex-1 truncate text-xs text-slate-500 line-through">{t.title}</span>
                      <span className="shrink-0 text-xs text-slate-600">{t.done_at ? zhTime(t.done_at) : ""}</span>
                      <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                        <button
                          onClick={() => restoreTodo(t)}
                          title="恢复为未完成"
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-amber-300"
                        >
                          ↩️
                        </button>
                        <button
                          onClick={() => startTodoEdit(t)}
                          title="修改"
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => removeTodo(t)}
                          title="删除"
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300"
                        >
                          🗑
                        </button>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </details>
          )}
        </section>

        {/* 今日日程：时间轴 / 列表 双视图 */}
        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-y-1">
            <h2 className="text-sm font-semibold text-slate-300">
              🕐 今日日程{" "}
              <span className="ml-1 whitespace-nowrap text-xs text-slate-500">
                {blocks.length} 段 · 共 {zhDuration(blocks.reduce((s, b) => s + b.duration_min, 0))}
              </span>
              {todayKcal > 0 && (
                <span className="ml-2 whitespace-nowrap rounded bg-orange-500/10 px-1.5 py-0.5 text-[11px] text-orange-300">
                  🍽 今日 ≈{todayKcal} kcal
                </span>
              )}
            </h2>
            <div className="flex shrink-0 rounded-full border border-white/10 bg-slate-950/50 p-0.5 text-xs">
              <button
                onClick={() => setView("timeline")}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 ${
                  view === "timeline"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                时间轴
              </button>
              <button
                onClick={() => setView("list")}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 ${
                  view === "list"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                列表
              </button>
            </div>
          </div>

          {view === "timeline" ? (
            <div>
            <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <DayDonut byActivity={todayByActivity} activities={activities} size={90} thickness={12} />
            </div>
            <DayTimeline
              date={todayStr()}
              blocks={blocks}
              activities={activities}
              onCreate={createBlock}
              onEditBlock={editBlockFromTimeline}
            />
            </div>
          ) : (
            <>
              <div ref={listFormRef}>
                {listDraft && (
                  <BlockDraftForm
                    value={listDraft}
                    activities={activities}
                    busy={listSaving}
                    onChange={setListDraft}
                    onCancel={() => setListDraft(null)}
                    onSubmit={submitListDraft}
                  />
                )}
              </div>
              <div className="mb-2 flex justify-end">
                <button
                  onClick={() => setListDraft(nextFreeSlot())}
                  className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-sky-300 transition hover:border-sky-500/50"
                >
                  ＋ 新增日程
                </button>
              </div>
              {blocks.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-600">
                  还没有记录 —— 说句"刚做完…"，点「＋ 新增日程」，或去完成一个待办
                </p>
              )}
              <ul className="space-y-1.5">
            {blocks.map((b) =>
              editing?.id === b.id ? (
                /* ---- 行内编辑器 ---- */
                <li key={b.id} className="rounded-lg border border-sky-500/40 bg-slate-800/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      className="min-w-32 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                      placeholder="标题"
                    />
                    <input
                      type="time"
                      value={editing.start}
                      onChange={(e) => setEditing({ ...editing, start: e.target.value })}
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <span className="text-xs text-slate-500">至</span>
                    <input
                      type="time"
                      value={editing.end}
                      onChange={(e) => setEditing({ ...editing, end: e.target.value })}
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <select
                      value={editing.activityId}
                      onChange={(e) => setEditing({ ...editing, activityId: e.target.value })}
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                    >
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.icon} {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-700"
                    >
                      取消
                    </button>
                    <button
                      onClick={saveEdit}
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </div>
                </li>
              ) : (
                /* ---- 常规行 ---- */
                <li key={b.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {zhTime(b.start_at)}–{zhTime(b.end_at)}
                  </span>
                  <span className="text-base">{b.icon}</span>
                  <span className="flex-1 truncate text-sm">{b.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{b.duration_min} 分钟</span>
                  <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={() => startEdit(b)}
                      title="修改"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeBlock(b)}
                      title="删除"
                      className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300"
                    >
                      🗑
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
            </>
          )}
        </section>

        <footer className="mt-10 text-center text-[10px] text-slate-600">
          拾光复利 · 第一阶段开发中 · 源码仓库 github.com/Ting97/shiguangri
        </footer>
      </div>
    </main>
  );
}
