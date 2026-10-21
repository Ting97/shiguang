"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, MessageSquare, Minus, Plus, Send, Sparkles, Trash2, ChevronDown } from "lucide-react";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import MarkdownView from "@/components/markdown-view";

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

/** A.5 操作确认卡（REQ-016）：助手提案 → 用户点「保存」才写业务数据 */
interface ProposalItem {
  id: string;
  kind: "fitness_plan";
  payload: {
    planDate: string;
    moduleCode: "run" | "strength";
    content: {
      title?: string;
      workoutType?: string;
      totalDistanceM?: number | null;
      durationMin?: number | null;
      segments?: { label: string; distanceM?: number | null; paceSPerKm?: number | null; reps?: number | null }[];
      exercises?: { name: string; sets?: number | null; repsText?: string | null; weightG?: number | null; rir?: number | null }[];
    };
    rationale?: string | null;
  };
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

/** 等待期状态文案轮换（约 2.4s 一轮，覆盖典型 GLM+查询耗时节奏） */
const THINKING_STEPS = ["正在理解你的问题…", "正在查询你的数据…", "正在整理回答…"];

/** 健身计划确认卡：模块/日期/动作明细（整数口径换算展示）+ 依据 + 保存/放弃 */
function ProposalCard({
  item,
  busy,
  xunjiEnabled,
  onResolve,
}: {
  item: ProposalItem;
  busy: boolean;
  /** 训记集成已配置时才展示「同时写入训记」勾选（REQ-017） */
  xunjiEnabled: boolean;
  onResolve: (action: "accept" | "dismiss", opts?: { syncXunji?: boolean }) => void;
}) {
  const c = item.payload.content ?? {};
  const isRun = item.payload.moduleCode === "run";
  // 训记写入默认关闭（REQ-024 后记）：确认卡的「保存」只确认拾光侧——写训记必须主动勾选
  const [syncXunji, setSyncXunji] = useState(false);
  const km = (m?: number | null) => (m != null ? `${Math.round(m / 100) / 10}km` : "");
  const paceOf = (s?: number | null) => (s != null ? `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, "0")}"` : "");
  const kgOf = (g?: number | null) => (g ? `${Math.round(g / 100) / 10}kg` : "");
  return (
    <div className="flex justify-start">
      <div className="w-[92%] rounded-2xl rounded-bl-md border border-sky-500/40 bg-surface p-3.5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-micro font-medium text-sky-600 dark:text-sky-400">
            🏋️ 计划确认卡
          </span>
          <span className="text-micro text-ink-faint">
            {item.payload.moduleCode === "run" ? "跑步" : "力量"} · {item.payload.planDate}
          </span>
        </div>
        <p className="mb-1.5 text-sm font-medium">
          {c.title}
          {c.totalDistanceM ? <span className="ml-2 text-xs text-ink-mute">{km(c.totalDistanceM)}{c.durationMin ? ` / ${c.durationMin} 分钟` : ""}</span> : null}
        </p>
        <div className="space-y-0.5 text-xs text-ink-mute">
          {isRun
            ? (c.segments ?? []).map((s, i) => (
                <p key={i}>
                  · {s.label}
                  {s.reps ? ` ×${s.reps}` : ""}
                  {s.distanceM ? ` ${km(s.distanceM)}` : ""}
                  {s.paceSPerKm ? ` @ ${paceOf(s.paceSPerKm)}/km` : ""}
                </p>
              ))
            : (c.exercises ?? []).map((e, i) => (
                <p key={i}>
                  · {e.name}
                  {e.weightG ? ` ${kgOf(e.weightG)}` : ""}
                  {e.sets || e.repsText ? ` × ${[e.sets, e.repsText].filter(Boolean).join("×")}` : ""}
                  {e.rir != null ? `（RIR ${e.rir}）` : ""}
                </p>
              ))}
        </div>
        {item.payload.rationale ? <p className="mt-2 text-micro leading-snug text-ink-faint">💡 {item.payload.rationale}</p> : null}
        {xunjiEnabled ? (
          <label className="mt-2.5 flex items-center gap-1.5 text-micro text-ink-mute">
            <input type="checkbox" checked={syncXunji} onChange={(e) => setSyncXunji(e.target.checked)} className="accent-sky-500" />
            同时写入训记 App（训练时在训记里打勾记录实练）
          </label>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => onResolve("dismiss")}>
            放弃
          </button>
          <button className="btn-primary px-4 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => onResolve("accept", { syncXunji })}>
            {busy ? "处理中…" : "保存计划并联动今日行动"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 分域助手元数据（REQ-019 FR-C）：标题/引导语/快捷问句随域切换 */
export type ChatScope = "global" | "goal" | "time" | "people" | "finance" | "fitness";

export const SCOPE_META: Record<ChatScope, { title: string; tagline: string; dockLabel: string; greeting: string; quick: string[]; placeholder: string }> = {
  global: {
    title: "拾光助手",
    tagline: "懂你数据的私人经营助手",
    dockLabel: "拾光助手",
    greeting: "问我任何关于你的时间、金钱、人际与目标的问题",
    quick: ["这周花了多少钱？花在哪了？", "最近在忙什么？时间都去哪了", "有什么该联系的人了吗", "今天我要做哪些行动", "点评昨天训练，明天力量怎么排"],
    placeholder: "问问你的数据，如「上个月人情往来花了多少」（Ctrl+Enter 发送）",
  },
  goal: {
    title: "目标管家",
    tagline: "目标空间 · 阶段 · 行动进度",
    dockLabel: "目标管家",
    greeting: "问我你的目标空间、阶段目标与行动进度",
    quick: ["哪个空间快到期了？", "考研上岸的行动进度怎么样", "帮我盘点各空间的阶段目标", "今天有哪些待办没完成"],
    placeholder: "如「考研空间最近进度如何」（Ctrl+Enter 发送）",
  },
  time: {
    title: "日程管家",
    tagline: "时间块 · 排程 · 复盘",
    dockLabel: "日程管家",
    greeting: "问我你的日程安排与时间去向",
    quick: ["今天还剩什么事？", "这周时间都花在哪了", "周六有空吗", "最近睡眠怎么样"],
    placeholder: "如「这周时间花哪了」（Ctrl+Enter 发送）",
  },
  people: {
    title: "人际管家",
    tagline: "联系人 · 往来 · 重要日期",
    dockLabel: "人际管家",
    greeting: "问我你的联系人、往来记录与重要日期",
    quick: ["有什么该联系的人了吗", "最近和谁互动最多", "快到生日的联系人有哪些", "多久没联系老板了"],
    placeholder: "如「最近该联系谁」（Ctrl+Enter 发送）",
  },
  finance: {
    title: "财务管家",
    tagline: "收支 · 预算 · 负债 · 交易",
    dockLabel: "财务管家",
    greeting: "问我你的收支、预算、负债与投资",
    quick: ["这个月花了多少？", "哪类支出涨得最快", "预算还剩多少", "最近负债/备付情况如何"],
    placeholder: "如「这个月餐饮花了多少」（Ctrl+Enter 发送）",
  },
  fitness: {
    title: "运动教练",
    tagline: "计划 · 打卡 · 身体指标 · 训记",
    dockLabel: "运动教练",
    greeting: "问我训练安排、执行点评与身体数据",
    quick: ["点评昨天的训练", "明天力量怎么排", "我的体重/腰围趋势", "训记里今天练了什么"],
    placeholder: "如「明天练什么」（Ctrl+Enter 发送）",
  },
};

export default function AssistantChat({
  variant,
  onMinimize,
  scope = "global",
}: {
  variant: "page" | "dock";
  /** dock 化小回调（page 无此钮） */
  onMinimize?: () => void;
  /** 会话域（REQ-019 FR-C）：global=全局拾光助手；其余为各域管家 */
  scope?: ChatScope;
}) {
  const isDock = variant === "dock";
  const meta = SCOPE_META[scope];
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [convLoading, setConvLoading] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false); // 移动端会话下拉
  const [xunjiEnabled, setXunjiEnabled] = useState(false); // 训记集成是否已配置（REQ-017 卡片勾选显隐）
  const [hasMore, setHasMore] = useState(false); // 更早消息还有否（分页：每页 6 条 = 3 轮）
  const [loadingMore, setLoadingMore] = useState(false);
  const [proposals, setProposals] = useState<ProposalItem[]>([]); // A.5 确认卡（pending 优先）
  const [proposalBusy, setProposalBusy] = useState<string | null>(null); // 处置中的卡片 id
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

  // 训记集成状态（失败静默——未配置只是不显示卡片勾选）
  useEffect(() => {
    api<{ enabled: boolean }>("/api/fitness/xunji-status")
      .then((r) => setXunjiEnabled(Boolean(r.enabled)))
      .catch(() => {});
  }, []);

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
    // 域助手只列本域会话（global 请求不传 scope=服务端全量，兼容整页全局视图）
    const qs = scope !== "global" ? `?scope=${scope}` : "";
    api<{ conversations: ConvItem[]; quota: QuotaInfo }>(`/api/chat${qs}`)
      .then((j) => {
        setConversations(j.conversations ?? []);
        setQuota(j.quota ?? null);
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "err"));
  }, [scope]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  function newConversation() {
    convSeq.current += 1; // 作废在途会话加载回包
    setActiveId(null);
    setMessages([]);
    setHasMore(false);
    setProposals([]);
  }

  // 会话切换请求序号守卫：快速切 A→B 时 A 的慢回包不得 setMessages 串台到 B；
  // loadOlder 与 openConversation 并发时同理（旧会话更早页 prepend 进新会话列表）
  const convSeq = useRef(0);

  async function openConversation(id: string) {
    if (sending || id === activeId) return;
    const seq = ++convSeq.current;
    setConvLoading(true);
    setActiveId(id);
    try {
      // 首屏只拉最近 3 轮（6 条），更早的按页向前翻
      const j = await api<{ conversation: ConvItem; messages: MsgItem[]; hasMore: boolean; proposals?: ProposalItem[] }>(`/api/chat?id=${id}`);
      if (seq !== convSeq.current) return;
      setMessages(j.messages ?? []);
      setHasMore(j.hasMore ?? false);
      setProposals(j.proposals ?? []);
    } catch (e) {
      if (seq !== convSeq.current) return;
      toast(e instanceof Error ? e.message : String(e), "err");
      setActiveId(null);
    } finally {
      if (seq === convSeq.current) setConvLoading(false);
    }
  }

  /** 向前翻一页（更早 3 轮）：追加后按增量恢复滚动位置，不跳底 */
  async function loadOlder() {
    if (!activeId || !hasMore || loadingMore || sending) return;
    const seq = ++convSeq.current;
    setLoadingMore(true);
    try {
      const box = scrollBoxRef.current;
      prependHeightRef.current = box ? box.scrollHeight : null;
      const j = await api<{ messages: MsgItem[]; hasMore: boolean }>(
        `/api/chat?id=${activeId}&before=${messages[0]?.id ?? ""}`,
      );
      if (seq !== convSeq.current) {
        prependHeightRef.current = null; // 失配丢弃回包前清掉，残留会让下一条消息被误判为翻页而不滚底
        return;
      }
      setMessages((ms) => [...(j.messages ?? []), ...ms]);
      setHasMore(j.hasMore ?? false);
    } catch (e) {
      prependHeightRef.current = null;
      if (seq === convSeq.current) toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      if (seq === convSeq.current) setLoadingMore(false);
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
    // 发送在途期间用户可能点「新对话」/删除当前会话/打开别的会话（都会推进 convSeq）：
    // 快照序号，回包落地前失配则丢弃，避免 setActiveId+setMessages 把视图劫持回旧会话
    const seq = convSeq.current;
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
        proposals?: ProposalItem[];
      }>(
        "/api/chat",
        "POST",
        { ...(activeId ? { conversationId: activeId } : {}), text: body, ...(scope !== "global" ? { scope } : {}) },
        undefined,
        { timeoutMs: 90_000 },
      );
      if (seq !== convSeq.current) return; // 在途被切走：消息已落库旧会话，重开可见，这里不回写状态
      setActiveId(j.conversationId);
      setMessages((ms) => [
        ...ms.map((m) => (m.id === optimisticId ? j.userMessage : m)),
        j.reply,
      ]);
      if (j.proposals) setProposals(j.proposals);
      if (j.quota) setQuota(j.quota);
      loadList(); // 新会话入列 / 既有会话置顶
    } catch (e) {
      if (seq !== convSeq.current) return; // 失败回包同样不跨会话回写（避免回填输入框覆盖新会话的输入）
      // 失败：移除乐观消息并把文本回填输入框（服务端可能已落库，重开该会话可见），错误以 toast 呈现，可重发
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

  /** A.5 确认卡处置：accept 先保存业务数据（fitness 域 API）成功后再回执；dismiss 直接放弃 */
  async function resolveProposalCard(item: ProposalItem, action: "accept" | "dismiss", opts?: { syncXunji?: boolean }) {
    if (proposalBusy) return;
    setProposalBusy(item.id);
    try {
      if (action === "accept") {
        const saved = await api<{ syncedActions: number; xunjiWarning?: string | null }>("/api/fitness/plans", "POST", {
          planDate: item.payload.planDate,
          moduleCode: item.payload.moduleCode,
          source: "ai",
          content: item.payload.content,
          rationale: item.payload.rationale ?? null,
          originConversationId: activeId ?? null,
          syncXunji: opts?.syncXunji ?? false,
        });
        toast(`✅ 计划已保存${saved.syncedActions ? `，联动 ${saved.syncedActions} 条今日行动` : ""}，可在健身页查看`);
        if (saved.xunjiWarning) toast(`训记同步未成功：${saved.xunjiWarning}`, "err");
      } else {
        toast("已放弃该计划");
      }
      await api(`/api/chat/proposals/${item.id}`, "POST", { action });
      setProposals((ps) =>
        ps.map((p) => (p.id === item.id ? { ...p, status: action === "accept" ? "accepted" : "dismissed" } : p)),
      );
    } catch (e) {
      // 保存失败（如 409 与已有计划冲突）如实展示，卡片保持 pending 可重试或放弃
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setProposalBusy(null);
    }
  }

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
          <h1 className={isDock ? "text-sm font-semibold" : "text-sm font-semibold"}>{meta.title}</h1>
          {!isDock && <span className="text-micro text-ink-faint">{meta.tagline}</span>}
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
                href={scope === "global" ? "/assistant" : `/assistant?scope=${scope}`}
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
              <p className="mb-1 text-sm font-medium">{meta.greeting}</p>
              <p className="mb-5 text-xs text-ink-dim">我会先查你的真实数据再回答，不编数字</p>
              <div className="mx-auto flex max-w-md flex-wrap justify-center gap-2">
                {meta.quick.map((q) => (
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
                        <MarkdownView value={m.content} size="sm" />
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
              {/* A.5 操作确认卡（REQ-016）：待确认在前，已决收成小角标 */}
              {proposals.length > 0 &&
                proposals.map((p) =>
                  p.status === "pending" ? (
                    <ProposalCard key={p.id} item={p} busy={proposalBusy === p.id} xunjiEnabled={xunjiEnabled} onResolve={(a, o) => resolveProposalCard(p, a, o)} />
                  ) : (
                    <div key={p.id} className="flex justify-start">
                      <span className="rounded-full bg-wash px-2.5 py-1 text-micro text-ink-faint">
                        {p.payload.content?.title ?? "计划"} · {p.status === "accepted" ? "已保存" : "已放弃"}
                      </span>
                    </div>
                  ),
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
              placeholder={meta.placeholder}
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
