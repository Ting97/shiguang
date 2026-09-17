"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Todo {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  done_at: string | null;
  activity_name: string | null;
  icon: string | null;
  color: string | null;
}
interface Block {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  duration_min: number;
  activity_name: string;
  icon: string;
  color: string;
  source: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDue = (iso: string | null) => {
  if (!iso) return "未定时间";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? "" : d.getFullYear() + "/"}${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtHM = (iso: string) => {
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
  const [todos, setTodos] = useState<Todo[]>([]);
  const [doneToday, setDoneToday] = useState<Todo[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/today");
    const j = await r.json();
    setTodos(j.todos ?? []);
    setDoneToday(j.doneToday ?? []);
    setBlocks(j.blocks ?? []);
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
      setMsg(
        j.kind === "todo"
          ? { ok: true, text: `📋 已创建待办：${fmtDue(j.todo.due_at)} ${j.todo.title}` }
          : {
              ok: true,
              text: `✅ 已记录日程：${j.result.time.durationMin} 分钟 · ${j.block.title}`,
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            拾光日 <span className="text-sm font-normal text-slate-500">工作台</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">说一句话 → 未来生成待办 · 过去记录日程</p>
        </header>

        {/* 输入区 */}
        <section className="mb-3 flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder='试试："明天下午三点去看牙医" 或 "刚跑完步40分钟"'
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500"
          />
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "解析中…" : "记录"}
          </button>
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
              return (
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
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{fmtDue(t.due_at)}</span>
                </li>
              );
            })}
          </ul>
          {doneToday.length > 0 && (
            <details className="mt-3 border-t border-slate-800 pt-3">
              <summary className="cursor-pointer text-xs text-slate-500">
                今日已完成 {doneToday.length} 项
              </summary>
              <ul className="mt-2 space-y-1">
                {doneToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-2 py-1 text-xs text-slate-500">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600/80 text-[9px] text-white">✓</span>
                    <span className="flex-1 truncate line-through">{t.title}</span>
                    <span>{t.done_at ? fmtHM(t.done_at) : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* 今日时间轴 */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            🕐 今日日程 <span className="ml-1 text-xs text-slate-500">
              {blocks.length} 段 · 共 {blocks.reduce((s, b) => s + b.duration_min, 0)} 分钟
            </span>
          </h2>
          {blocks.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-600">
              还没有记录 —— 说句"刚做完…"，或去完成一个待办
            </p>
          )}
          <ul className="space-y-1.5">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {fmtHM(b.start_at)}–{fmtHM(b.end_at)}
                </span>
                <span className="text-base">{b.icon}</span>
                <span className="flex-1 truncate text-sm">{b.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{b.duration_min} 分钟</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-10 text-center text-[10px] text-slate-600">
          拾光日 shiguangri · Phase 1 开发中 · github.com/Ting97/shiguangri
        </footer>
      </div>
    </main>
  );
}
