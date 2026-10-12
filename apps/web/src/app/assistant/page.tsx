"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { useArmConfirm } from "@/lib/use-arm-confirm";

/**
 * AI 对话助手（REQ-015 批次 A）：懂用户数据的私人经营助手。
 * 只读查询（8 工具服务端执行）+ 建议教练；操作能力批次 A.5 再上（确认卡）。
 * MVP 非流式：等待期「正在查询你的数据…」状态轮换；工具轨迹随回答落库展示。
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

export default function AssistantPage() {
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [convLoading, setConvLoading] = useState(false);
  const arm = useArmConfirm();
  const bottomRef = useRef<HTMLDivElement>(null);

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
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

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
  }

  async function openConversation(id: string) {
    if (sending || id === activeId) return;
    setConvLoading(true);
    setActiveId(id);
    try {
      const j = await api<{ conversation: ConvItem; messages: MsgItem[] }>(`/api/chat?id=${id}`);
      setMessages(j.messages ?? []);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
      setActiveId(null);
    } finally {
      setConvLoading(false);
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
    <main className="min-h-screen text-ink">
      <div className="mx-auto flex max-w-4xl flex-col px-5 pb-8 pt-6 lg:flex-row lg:gap-6 lg:pt-8">
        {/* 会话侧栏：PC 左栏；移动端顶部横滑条 */}
        <aside className="mb-3 shrink-0 lg:mb-0 lg:w-56">
          <button
            onClick={newConversation}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-2 text-xs font-medium text-white shadow-md shadow-sky-500/25 transition hover:opacity-90"
          >
            <Plus size={14} aria-hidden /> 新对话
          </button>
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs transition lg:w-full ${
                  c.id === activeId ? "bg-wash font-medium text-ink" : "text-ink-mute hover:bg-wash hover:text-ink"
                }`}
              >
                <button onClick={() => openConversation(c.id)} className="max-w-36 truncate text-left" title={c.title}>
                  <MessageSquare size={11} className="mr-1 inline shrink-0" aria-hidden />
                  {c.title}
                </button>
                <button
                  onClick={() => removeConversation(c.id)}
                  aria-label="删除会话"
                  className={`ml-auto shrink-0 rounded p-0.5 transition ${
                    arm.armedId === c.id ? "text-rose-400" : "text-ink-faint opacity-0 group-hover:opacity-100 hover:text-rose-400"
                  }`}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* 对话主区 */}
        <section className="glass flex min-h-[70vh] flex-1 flex-col rounded-2xl">
          <header className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <Sparkles size={16} className="text-ai" aria-hidden />
            <h1 className="text-sm font-semibold">AI 助手</h1>
            <span className="text-micro text-ink-faint">懂你数据的私人经营助手</span>
            {quotaText && (
              <span className="ml-auto rounded-full bg-violet-500/15 px-2 py-0.5 text-micro text-ai">{quotaText}</span>
            )}
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {convLoading ? (
              <p className="py-8 text-center text-xs text-ink-faint">加载会话…</p>
            ) : messages.length === 0 && !sending ? (
              <div className="py-8 text-center">
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
                        <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line-soft bg-surface px-3.5 py-2.5 text-sm leading-relaxed">
                          {m.content}
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
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="问问你的数据，如「上个月人情往来花了多少」"
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
            <p className="mt-1.5 text-micro text-ink-faint">回答基于工具查询的真实数据 · 想记账去首页发一句话动态</p>
          </footer>
        </section>
      </div>
    </main>
  );
}
