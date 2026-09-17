"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/nav";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import MomentFeed from "@/components/moment-feed";
import { todayStr } from "@/lib/date";
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
  const today = new Date();
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400_000);
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const [todayRes, feedRes] = await Promise.all([
      fetch("/api/today"),
      fetch("/api/feed?limit=50"),
    ]);
    const j = await todayRes.json();
    setTodos(j.todos ?? []);
    setDoneToday(j.doneToday ?? []);
    setBlocks(j.blocks ?? []);
    setActivities(j.activities ?? []);
    const f = await feedRes.json();
    setMoments(f.moments ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
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
      setMsg(
        j.kind === "todo"
          ? { ok: true, text: `📋 已创建待办：${zhDateTime(j.todo.due_at)} ${j.todo.title}${moodTag}` }
          : j.kind === "moment"
            ? { ok: true, text: `✨ 已记录此刻${moodTag}` }
            : {
                ok: true,
                text: `✅ 已记录日程：${j.result.time.durationMin} 分钟 · ${j.block.title}${moodTag}`,
              },
      );
      setText("");
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `解析失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  /** 删除动态（连同 AI 识别生成的日程/待办/流水） */
  async function deleteMoment(m: FeedMoment) {
    const r = await fetch(`/api/feed/${m.id}`, { method: "DELETE" });
    if (!r.ok) {
      setMsg({ ok: false, text: "删除失败" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除这条动态及其识别结果` });
    await load();
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold">
            拾光复利 <span className="text-sm font-normal text-slate-500">动态</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来待办
          </p>
        </header>

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
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-600">Enter 发布 · Shift+Enter 换行</span>
            <button
              onClick={submit}
              disabled={busy || !text.trim()}
              className="rounded-lg bg-sky-600 px-6 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
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

        {/* 动态流：每条记录都是一条动态（记录时刻 + AI 识别结果） */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            🌱 我的动态 <span className="ml-1 text-xs font-normal text-slate-500">{moments.length} 条</span>
          </h2>
          <MomentFeed moments={moments} onDelete={deleteMoment} />
        </section>

        {/* 待办列表 */}
        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
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
                  <span className="hidden shrink-0 gap-1 group-hover:flex">
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
                      <span className="hidden shrink-0 gap-1 group-hover:flex">
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
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              🕐 今日日程 <span className="ml-1 text-xs text-slate-500">
                {blocks.length} 段 · 共 {blocks.reduce((s, b) => s + b.duration_min, 0)} 分钟
              </span>
            </h2>
            <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
              <button
                onClick={() => setView("timeline")}
                className={`rounded-md px-2.5 py-1 ${view === "timeline" ? "bg-sky-600 font-medium" : "text-slate-400 hover:text-slate-200"}`}
              >
                时间轴
              </button>
              <button
                onClick={() => setView("list")}
                className={`rounded-md px-2.5 py-1 ${view === "list" ? "bg-sky-600 font-medium" : "text-slate-400 hover:text-slate-200"}`}
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
              {blocks.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-600">
                  还没有记录 —— 说句"刚做完…"，或去完成一个待办
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
                  <span className="hidden shrink-0 gap-1 group-hover:flex">
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
