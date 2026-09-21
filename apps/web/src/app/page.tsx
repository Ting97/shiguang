"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/nav";
import DayTimeline from "@/components/day-timeline";
import DayDonut from "@/components/day-donut";
import MomentFeed from "@/components/moment-feed";
import Reminders from "@/components/reminders";
import TodayTodos from "@/components/today-todos";
import { pickReminders, type ReminderContact, type ReminderItem, type ReminderTodo } from "@/lib/reminders";
import BlockDraftForm, { type BlockDraftValue } from "@/components/block-draft-form";
import VoiceButton from "@/components/voice-button";
import CaptureButton from "@/components/capture-button";
import PublishSheet from "@/components/publish-sheet";
import { parseYmd, todayStr, zhDuration } from "@/lib/date";
import type { Activity, Block, FeedMoment, TodoItem, TodoRow } from "@/lib/types";

interface BlockDraft {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const zhTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const FEED_PAGE_SIZE = 10; // 动态流每页条数，「加载更多」按页追加

export default function Home() {
  const [text, setText] = useState("");
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
  const [feedTotal, setFeedTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState(""); // 生效中的搜索词（输入防抖后）
  const [loadingMore, setLoadingMore] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [doneToday, setDoneToday] = useState<TodoRow[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [todayKcal, setTodayKcal] = useState(0);
  const [listDraft, setListDraft] = useState<BlockDraftValue | null>(null);
  const [listSaving, setListSaving] = useState(false);
  const listFormRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 移动端发布：sheetOpen 控制底部输入面板；voiceDraft 是长按语音转写出的待预览文字
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [reminderItems, setReminderItems] = useState<ReminderItem[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 发布后识别产物的延迟刷新定时器（卸载时清理，避免对已卸载组件 setState）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timers = refreshTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const load = useCallback(async (opts?: { limit?: number; query?: string }) => {
    // opts 用于「状态尚未生效就要请求」的场景（如发布后清空搜索再刷新）
    const lim = opts?.limit ?? feedLimit;
    const q = opts?.query !== undefined ? opts.query : query;
    const [todayRes, feedRes, reminderRes] = await Promise.all([
      fetch("/api/today"),
      fetch(`/api/feed?limit=${lim}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
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
    setFeedTotal(f.total ?? 0);
    // W12 提醒横幅：接口失败不打扰主流程
    try {
      const rj = await reminderRes.json();
      setReminderItems(pickReminders((rj.contacts ?? []) as ReminderContact[], (rj.todos ?? []) as ReminderTodo[]));
    } catch {
      setReminderItems([]);
    }
  }, [feedLimit, query]);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索词输入防抖：停顿 400ms 才真正检索
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 「加载更多」追加一页后 moments 更新，复位按钮加载态
  useEffect(() => {
    setLoadingMore(false);
  }, [moments]);

  function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setFeedLimit((l) => l + FEED_PAGE_SIZE);
  }

  useEffect(() => {
    if (!msg) return;
    // 成功提示短展示；失败/警示保留更久，避免用户错过原因
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  /** 发布一条动态：桌面输入框与移动端悬浮圆圈面板共用的唯一提交路径 */
  async function publish(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const j = await r.json();
      // 防御非约定响应（网关错误页/结构变更）：给出可读原因，而不是 TypeError
      if (!r.ok || !j?.entry) throw new Error(j?.error || `服务异常(${r.status})，请稍后重试`);
      // 动态已秒存上墙；五域识别在后台进行，完成后由延迟刷新呈现
      setMsg({ ok: true, text: "✨ 已记录动态，AI 正在识别日程 / 关系 / 待办 / 收支 / 心情 / 饮食…" });
      setText("");
      // 新动态要立即可见：搜索过滤中则清空搜索再刷新
      if (query || searchInput) {
        setSearchInput("");
        setQuery("");
        await load({ query: "" });
      } else {
        await load();
      }
      // 识别通常数秒完成：安排两轮延迟刷新把识别产物带上墙（组件卸载时清理）
      for (const delay of [6000, 16000]) {
        const t2 = setTimeout(() => void load(), delay);
        refreshTimers.current.push(t2);
      }
    } catch (e) {
      setMsg({ ok: false, text: `记录失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
      // 移动端不回焦输入框（会把视口拽回顶部并重新拉起键盘，打断阅读动态流）
      if (window.innerWidth >= 640) inputRef.current?.focus();
    }
  }

  async function submit() {
    await publish(text);
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
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 pb-28 pt-5 sm:pb-8 sm:pt-8">
        <Nav />
        <header className="mb-5 text-center sm:mb-7">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光
            <span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">动态</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">
            随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来待办
          </p>
        </header>

        {/* W12 提醒横幅：生日/纪念日/到期待办（待办可一键加入今日 TODO） */}
        <Reminders
          items={reminderItems}
          onMarkToday={async (todoId, label) => {
            const r = await fetch(`/api/todos/${todoId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ today: true }),
            });
            if (r.ok) {
              setMsg({ ok: true, text: `☀️ 已加入今日 TODO` });
              await load();
            } else {
              setMsg({ ok: false, text: `加入今日失败（${label.slice(0, 20)}…）` });
            }
          }}
        />

        {/* 输入区（桌面端；移动端改用底部悬浮圆圈：点按打字 / 长按说话） */}
        <section className="mb-3 hidden sm:block">
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
            className="input-glow w-full resize-none rounded-xl border border-line-soft bg-surface/60 px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <VoiceButton
                onText={(t) => setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
                onError={(m) => setMsg({ ok: false, text: m })}
                onHint={(m) => setMsg({ ok: true, text: m })}
              />
              <span className="hidden text-[11px] text-ink-faint sm:block">🎤 按住说话 · Enter 发布</span>
            </div>
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
          <div className={`msg-banner mb-5 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>
        )}

        {/* 今日 TODO：只展示手动标记今日的待办（每天重新规划；完整管理在「日程 · TODO」） */}
        <TodayTodos todos={todos} doneToday={doneToday} activities={activities} onChanged={load} notify={setMsg} />

        {/* 动态流：每条记录都是一条动态（记录时刻 + AI 识别结果，均可修改/删除） */}
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 className="text-sm font-semibold text-ink-soft">
              🌱 我的动态{" "}
              <span className="ml-1 text-xs font-normal text-ink-dim">
                {query
                  ? `找到 ${feedTotal} 条`
                  : feedTotal > 0
                    ? `共 ${feedTotal} 条${feedTotal > moments.length ? ` · 已显示 ${moments.length} 条` : " · 悬停卡片可修正识别"}`
                    : ""}
              </span>
            </h2>
            <div className="relative w-full sm:w-64">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchInput("");
                }}
                placeholder="🔍 搜索：原文/日程/待办/金额/联系人"
                className="w-full rounded-xl border border-line-soft bg-surface/60 py-1.5 pl-3 pr-8 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500/60"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  title="清除搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-dim hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <MomentFeed
            moments={moments}
            activities={activities}
            onRefresh={load}
            moreCount={Math.max(0, feedTotal - moments.length)}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            searching={!!query}
            searchKeyword={query}
          />
        </section>

        {/* 今日日程：时间轴 / 列表 双视图 */}
        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-y-1">
            <h2 className="text-sm font-semibold text-ink-soft">
              🕐 今日日程{" "}
              <span className="ml-1 whitespace-nowrap text-xs text-ink-dim">
                {blocks.length} 段 · 共 {zhDuration(blocks.reduce((s, b) => s + b.duration_min, 0))}
              </span>
              {todayKcal > 0 && (
                <span className="ml-2 whitespace-nowrap rounded bg-orange-500/10 px-1.5 py-0.5 text-[11px] text-warn">
                  🍽 今日 ≈{todayKcal} kcal
                </span>
              )}
            </h2>
            <div className="flex shrink-0 rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs">
              <button
                onClick={() => setView("timeline")}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 ${
                  view === "timeline"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-ink-mute hover:bg-wash hover:text-ink"
                }`}
              >
                时间轴
              </button>
              <button
                onClick={() => setView("list")}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition-all duration-200 ${
                  view === "list"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-ink-mute hover:bg-wash hover:text-ink"
                }`}
              >
                列表
              </button>
            </div>
          </div>

          {view === "timeline" ? (
            <div>
            <div className="mb-3 rounded-lg border border-line-soft bg-bg/40 p-3">
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
                  className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-accent transition hover:border-sky-500/50"
                >
                  ＋ 新增日程
                </button>
              </div>
              {blocks.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-faint">
                  还没有记录 —— 说句"刚做完…"，点「＋ 新增日程」，或去完成一个待办
                </p>
              )}
              <ul className="space-y-1.5">
            {blocks.map((b) =>
              editing?.id === b.id ? (
                /* ---- 行内编辑器 ---- */
                <li key={b.id} className="rounded-lg border border-sky-500/40 bg-elevated/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      className="min-w-32 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
                      placeholder="标题"
                    />
                    <input
                      type="time"
                      value={editing.start}
                      onChange={(e) => setEditing({ ...editing, start: e.target.value })}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <span className="text-xs text-ink-dim">至</span>
                    <input
                      type="time"
                      value={editing.end}
                      onChange={(e) => setEditing({ ...editing, end: e.target.value })}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums outline-none focus:border-sky-500"
                    />
                    <select
                      value={editing.activityId}
                      onChange={(e) => setEditing({ ...editing, activityId: e.target.value })}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-sky-500"
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
                      className="rounded px-3 py-1 text-xs text-ink-mute hover:bg-soft"
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
                <li key={b.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-elevated/60">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="shrink-0 text-xs tabular-nums text-ink-mute">
                    {zhTime(b.start_at)}–{zhTime(b.end_at)}
                  </span>
                  <span className="text-base">{b.icon}</span>
                  <span className="flex-1 truncate text-sm">{b.title}</span>
                  <span className="shrink-0 text-xs text-ink-dim">{b.duration_min} 分钟</span>
                  <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                    <button
                      onClick={() => startEdit(b)}
                      title="修改"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeBlock(b)}
                      title="删除"
                      className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger"
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

        <footer className="mt-10 text-center text-[10px] text-ink-faint">
          拾光 · 第一阶段开发中 · 源码仓库 github.com/Ting97/shiguang
        </footer>
      </div>

      {/* 移动端发布入口：底部悬浮圆圈（点按打字 / 长按说话，转写后回填面板预览） */}
      <CaptureButton
        onTap={() => {
          setVoiceDraft("");
          setSheetOpen(true);
        }}
        onVoiceText={(t) => {
          setVoiceDraft(t);
          setSheetOpen(true);
        }}
        onError={(m) => setMsg({ ok: false, text: m })}
        onHint={(m) => setMsg({ ok: true, text: m })}
      />
      <PublishSheet
        open={sheetOpen}
        initialText={voiceDraft}
        busy={busy}
        onPublish={async (t) => {
          await publish(t);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </main>
  );
}
