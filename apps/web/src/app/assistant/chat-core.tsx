"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, MessageSquare, Minus, Plus, Send, Sparkles, Trash2, ChevronDown } from "lucide-react";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import Markdown from "@/components/markdown";

/**
 * 拾光助手对话核心（REQ-015）：/assistant 整页与首页悬浮 Dock 共用一套状态与消息流。
 * - variant="page"：会话侧栏 + 对话主区（整页布局）
 * - variant="dock"：紧凑面板——无侧栏，头部带 新对话/放大到整页/化小 三钮
 */

interface ConvItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface ToolTraceItem {
  name: string;
  label?: string;
  args: unknown;
}

interface MsgItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolTraceItem[];
  createdAt: string;
}

interface QuotaInfo {
  plan: "free" | "pro";
  usedToday: number;
  limit: number | null;
}

const QUICK_QUESTIONS = [
  "这周花了多少钱？花在哪了？",
  "最近在忙什么？时间都去哪了",
  "有什么该联系的人了吗",
  "我的到期待办有哪些",
  "最近心情怎么样",
];

/** 等待期状态文案轮换（约 2.4s 一轮，覆盖典型 GLM+查询耗时节奏） */
const THINKING_STEPS = ["正在理解你的问题…", "正在查询你的数据…", "正在整理回答…"];

export default function AssistantChat({
  variant,
  onMinimize,
}: {
  variant: "page" | "dock";
  /** dock 化小回调（page 无此钮） */
  onMinimize?: () => void;
}) {
  const isDock = variant === "dock";
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [convLoading, setConvLoading] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false); // 移动端会话下拉
  const [hasMore, setHasMore] = useState(false); // 更早消息还有否（分页：每页 6 条 = 3 轮）
  const [loadingMore, setLoadingMore] = useState(false);
  const arm = useArmConfirm();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  // 向前翻页后按「新增高度」恢复滚动位置（否则会被自动滚底覆盖）
  const prependHeightRef = useRef<number | null>(null);
  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  // 等待期文案轮换
  useEffect(() => {
    if (!sending) return;
    setThinkingStep(0);
    const t = setInterval(() => setThinkingStep((s) => (s + 1) % THINKING_STEPS.length), 2400);
    return () => clearInterval(t);
  }, [sending]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    // 前翻页追加旧消息时不自动滚底——滚动位置由下方 effect 按增量恢复
    if (prependHeightRef.current != null) return;
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  useEffect(() => {
    const box = scrollBoxRef.current;
    if (prependHeightRef.current == null || !box) return;
    box.scrollTop = box.scrollHeight - prependHeightRef.current;
    prependHeightRef.current = null;
  }, [messages]);

  const loadList = useCallback(() => {
    api<{ conversations: ConvItem[]; quota: QuotaInfo }>("/api/chat")
      .then((j) => {
        setConversations(j.conversations ?? []);
        setQuota(j.quota ?? null);
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "err"));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setHasMore(false);
  }

  async function openConversation(id: string) {
    if (sending || id === activeId) return;
    setConvLoading(true);
    setActiveId(id);
    try {
      // 首屏只拉最近 3 轮（6 条），更早的按页向前翻
      const j = await api<{ conversation: ConvItem; messages: MsgItem[]; hasMore: boolean }>(`/api/chat?id=${id}`);
      setMessages(j.messages ?? []);
      setHasMore(j.hasMore ?? false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
      setActiveId(null);
    } finally {
      setConvLoading(false);
    }
  }

  /** 向前翻一页（更早 3 轮）：追加后按增量恢复滚动位置，不跳底 */
  async function loadOlder() {
    if (!activeId || !hasMore || loadingMore || sending) return;
    setLoadingMore(true);
    try {
      const box = scrollBoxRef.current;
      prependHeightRef.current = box ? box.scrollHeight : null;
      const j = await api<{ messages: MsgItem[]; hasMore: boolean }>(
        `/api/chat?id=${activeId}&before=${messages[0]?.id ?? ""}`,
      );
      setMessages((ms) => [...(j.messages ?? []), ...ms]);
      setHasMore(j.hasMore ?? false);
    } catch (e) {
      prependHeightRef.current = null;
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeConversation(id: string) {
    if (!arm.arm(id)) return; // 两步确认（全站规范）
    try {
      await api(`/api/chat/${id}`, "DELETE");
      setConversations((list) => list.filter((c) => c.id !== id));
      if (activeId === id) newConversation();
      toast("已删除会话");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  async function send(text?: string) {
    const body = (text ?? input).trim();
    if (!body || sending) return;
    setSending(true);
    setInput("");
    const optimisticId = `local-${Date.now()}`;
    setMessages((ms) => [...ms, { id: optimisticId, role: "user", content: body, createdAt: "" }]);
    try {
      // 服务端 LLM+工具循环总预算 60s，客户端放宽到 90s
      const j = await api<{
        conversationId: string;
        userMessage: MsgItem;
        reply: MsgItem;
        quota: QuotaInfo;
      }>(
        "/api/chat",
        "POST",
        { ...(activeId ? { conversationId: activeId } : {}), text: body },
        undefined,
        { timeoutMs: 90_000 },
      );
      setActiveId(j.conversationId);
      setMessages((ms) => [
        ...ms.map((m) => (m.id === optimisticId ? j.userMessage : m)),
        j.reply,
      ]);
      if (j.quota) setQuota(j.quota);
      loadList(); // 新会话入列 / 既有会话置顶
    } catch (e) {
      // 失败保留用户消息（服务端已落库），错误以 toast 呈现，可重发
      toast(e instanceof Error ? e.message : String(e), "err");
      setMessages((ms) => ms.filter((m) => m.id !== optimisticId));
      setInput(body);
    } finally {
      setSending(false);
    }
  }

  const quotaText = quota
    ? quota.limit === null
      ? "Pro · 不限次数"
      : `今日 ${quota.usedToday}/${quota.limit} 次`
    : "";

  return (
    <>
      {/* 移动端会话切换（<lg）：下拉选择 + 新对话；整页自然滚动配套 */}
      {!isDock && (
        <div className="relative mb-3 lg:hidden">
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-expanded={switcherOpen}
            className="flex w-full items-center gap-2 rounded-xl border border-line-soft bg-surface px-3.5 py-2.5 text-left text-xs"
          >
            <MessageSquare size={13} className="shrink-0 text-ink-faint" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{activeTitle ?? "新对话"}</span>
            <span className="shrink-0 text-micro text-ink-faint">{conversations.length} 个会话</span>
            <ChevronDown size={14} className={`shrink-0 text-ink-faint transition ${switcherOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {switcherOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[50vh] overflow-y-auto rounded-xl border border-line-soft bg-surface shadow-lg shadow-scrim/20">
              <button
                onClick={() => {
                  newConversation();
                  setSwitcherOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-line-soft px-3.5 py-2.5 text-xs font-medium text-accent"
              >
                <Plus size={14} aria-hidden /> 新对话
              </button>
              {conversations.map((c) => (
                <div key={c.id} className={`group flex items-center gap-1 px-1.5 ${c.id === activeId ? "bg-wash" : ""}`}>
                  <button
                    onClick={() => {
                      openConversation(c.id);
                      setSwitcherOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate py-2.5 text-left text-xs"
                  >
                    {c.title}
                    <span className="ml-1.5 text-micro text-ink-faint">{c.updatedAt}</span>
                  </button>
                  <button
                    onClick={() => removeConversation(c.id)}
                    aria-label="删除会话"
                    className={`shrink-0 rounded p-1.5 transition ${
                      arm.armedId === c.id ? "text-rose-400" : "text-ink-faint group-hover:text-rose-400"
                    }`}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              ))}
              {!conversations.length && <p className="px-3.5 py-3 text-xs text-ink-faint">还没有会话，发第一条消息开始</p>}
            </div>
          )}
        </div>
      )}

      {/* 会话侧栏：仅整页桌面（≥lg） */}
      {!isDock && (
        <aside className="mb-3 hidden shrink-0 lg:mb-0 lg:block lg:w-56">
          <button
            onClick={newConversation}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-2 text-xs font-medium text-white shadow-md shadow-sky-500/25 transition hover:opacity-90"
          >
            <Plus size={14} aria-hidden /> 新对话
          </button>
          <div className="space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex w-full items-center gap-1 rounded-xl px-3 py-2 text-xs transition ${
                  c.id === activeId ? "bg-wash font-medium text-ink" : "text-ink-mute hover:bg-wash hover:text-ink"
                }`}
              >
                <button onClick={() => openConversation(c.id)} className="min-w-0 flex-1 truncate text-left" title={c.title}>
                  <MessageSquare size={11} className="mr-1 inline shrink-0" aria-hidden />
                  {c.title}
                </button>
                <button
                  onClick={() => removeConversation(c.id)}
                  aria-label="删除会话"
                  className={`shrink-0 rounded p-0.5 transition ${
                    arm.armedId === c.id ? "text-rose-400" : "text-ink-faint opacity-0 group-hover:opacity-100 hover:text-rose-400"
                  }`}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 对话主区：PC/移动统一固定高度、面板内滚动（首屏仅最近 3 轮，更早翻页加载） */}
      <section
        className={`glass flex flex-col overflow-hidden rounded-2xl ${
          isDock ? "h-full w-full" : "h-[calc(100dvh-11rem)] min-h-[26rem] lg:h-auto lg:min-h-[70vh] lg:flex-1"
        }`}
      >
        <header className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
          <Sparkles size={16} className="text-ai" aria-hidden />
          <h1 className={isDock ? "text-sm font-semibold" : "text-sm font-semibold"}>拾光助手</h1>
          {!isDock && <span className="text-micro text-ink-faint">懂你数据的私人经营助手</span>}
          {quotaText && (
            <span className="ml-auto rounded-full bg-violet-500/15 px-2 py-0.5 text-micro text-ai">{quotaText}</span>
          )}
          {isDock && (
            <div className={quotaText ? "flex items-center gap-0.5" : "ml-auto flex items-center gap-0.5"}>
              <button
                onClick={newConversation}
                aria-label="新对话"
                title="新对话"
                className="rounded-lg p-1.5 text-ink-mute transition hover:bg-wash hover:text-ink"
              >
                <Plus size={15} aria-hidden />
              </button>
              <Link
                href="/assistant"
                aria-label="放大到整页"
                title="放大到整页（含历史会话）"
                className="rounded-lg p-1.5 text-ink-mute transition hover:bg-wash hover:text-ink"
              >
                <Maximize2 size={14} aria-hidden />
              </Link>
              {onMinimize && (
                <button
                  onClick={onMinimize}
                  aria-label="化小"
                  title="化小"
                  className="rounded-lg p-1.5 text-ink-mute transition hover:bg-wash hover:text-ink"
                >
                  <Minus size={15} aria-hidden />
                </button>
              )}
            </div>
          )}
        </header>

        <div ref={scrollBoxRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {!convLoading && hasMore && messages.length > 0 && (
            <div className="flex justify-center">
              <button
                onClick={loadOlder}
                disabled={loadingMore}
                className="rounded-full border border-line-soft bg-surface px-3 py-1 text-xs text-ink-mute transition hover:border-sky-500/50 hover:text-accent disabled:opacity-50"
              >
                {loadingMore ? "加载中…" : "↑ 查看更早对话"}
              </button>
            </div>
          )}
          {convLoading ? (
            <p className="py-8 text-center text-xs text-ink-faint">加载会话…</p>
          ) : messages.length === 0 && !sending ? (
            <div className={isDock ? "py-4 text-center" : "py-8 text-center"}>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15">
                <Sparkles size={22} className="text-ai" aria-hidden />
              </div>
              <p className="mb-1 text-sm font-medium">问我任何关于你的时间、金钱、人际与目标的问题</p>
              <p className="mb-5 text-xs text-ink-dim">我会先查你的真实数据再回答，不编数字</p>
              <div className="mx-auto flex max-w-md flex-wrap justify-center gap-2">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-full border border-line-soft bg-surface px-3 py-1.5 text-xs text-ink-mute transition hover:border-sky-500/50 hover:text-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-sky-500 to-indigo-500 px-3.5 py-2.5 text-sm text-white shadow-sm">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div className="max-w-[92%]">
                      {!!m.toolCalls?.length && (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {m.toolCalls.map((tc, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-violet-500/10 px-2 py-0.5 text-micro text-ai"
                              title={`工具 ${tc.name}`}
                            >
                              已查询：{tc.label ?? tc.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="rounded-2xl rounded-bl-md border border-line-soft bg-surface px-3.5 py-2.5">
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  </div>
                ),
              )}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-line-soft bg-surface px-3.5 py-2.5 text-sm text-ink-mute">
                    <Sparkles size={14} className="animate-pulse text-ai" aria-hidden />
                    {THINKING_STEPS[thinkingStep]}
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <footer className="border-t border-line-soft p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Enter（Mac Cmd+Enter）发送；裸 Enter 换行
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="问问你的数据，如「上个月人情往来花了多少」（Ctrl+Enter 发送）"
              className="max-h-32 flex-1 resize-none rounded-xl border border-line-soft bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-ink-faint focus:border-sky-500/60"
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              aria-label="发送"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-md shadow-sky-500/25 transition hover:opacity-90 disabled:opacity-40"
            >
              <Send size={16} aria-hidden />
            </button>
          </div>
          <p className="mt-1.5 text-micro text-ink-faint">Ctrl+Enter 发送 · 回答基于工具查询的真实数据 · 想记账去首页发一句话动态</p>
        </footer>
      </section>
    </>
  );
}
