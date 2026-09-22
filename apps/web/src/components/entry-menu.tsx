"use client";

import { useState } from "react";
import { useDismiss } from "./dismissable";
import {
  Clock, ListTodo, Wallet, Smile, Users, Utensils,
  Sparkles, PencilLine, X, Check, Plus,
} from "lucide-react";
import type { Activity, FeedMoment } from "@/lib/types";
import { COMMON_MOODS } from "./moment-feed";

const SIX = [
  { key: "schedule", icon: Clock, label: "日程", hint: "做了什么事" },
  { key: "todo", icon: ListTodo, label: "todo", hint: "之后要做" },
  { key: "finance", icon: Wallet, label: "收支", hint: "花了 / 收入" },
  { key: "mood", icon: Smile, label: "心情", hint: "此刻情绪" },
  { key: "people", icon: Users, label: "关系", hint: "和谁在一起" },
  { key: "diet", icon: Utensils, label: "饮食", hint: "吃了什么" },
] as const;

type SixKey = (typeof SIX)[number]["key"];

interface Props {
  m: FeedMoment;
  activities: Activity[];
  busyDomain: string | null;
  onAI: (domain: string) => void;
  onManual: (domain: SixKey, payload: Record<string, unknown>) => void | Promise<void>;
  /** 手动归属/移除目标空间（spaceId=null 移除） */
  onSetSpace: (spaceId: string | null) => void | Promise<void>;
  onClose: () => void;
}

/** 域状态：按已落库产物推断 */
function domainState(m: FeedMoment, key: SixKey): "applied" | "none" {
  switch (key) {
    case "schedule": return m.blocks.length > 0 ? "applied" : "none";
    case "todo": return m.todos.length > 0 ? "applied" : "none";
    case "finance": return m.transactions.length > 0 ? "applied" : "none";
    case "mood": return m.mood ? "applied" : "none";
    case "people": return m.people.length > 0 ? "applied" : "none";
    case "diet": return m.diet ? "applied" : "none";
  }
}

const inputCls =
  "min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-sky-500";
const btnMini = "shrink-0 inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-sky-500";

/** 识别菜单：六域（AI 识别 / 手动添加）。移动端底部弹层，桌面锚定卡片浮层 */
export default function EntryMenu({ m, activities, busyDomain, onAI, onManual, onSetSpace, onClose, desktopPos }: Props & { desktopPos?: { top: number; left: number } | null }) {
  const [manualDomain, setManualDomain] = useState<SixKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState<Array<{ id: string; name: string; icon: string; color: string; status: string }> | null>(null);

  const [text, setText] = useState("");
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [due, setDue] = useState("");
  const [direction, setDirection] = useState("out");
  const [yuan, setYuan] = useState("");
  const [category, setCategory] = useState("餐饮");
  const [mood, setMood] = useState("");
  const [meal, setMeal] = useState("午餐");
  const [pType, setPType] = useState("见面");

  function openManual(key: SixKey) {
    setManualDomain(key === manualDomain ? null : key);
  }

  async function submitManual(key: SixKey) {
    if (busy) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown> = {};
      if (key === "schedule") payload = { title: text, startTime: start, endTime: end, activityId: activities[0]?.id ?? "other" };
      else if (key === "todo") payload = { title: text, dueAt: due || null };
      else if (key === "finance") payload = { direction, yuan: Number(yuan), category };
      else if (key === "mood") payload = { label: mood };
      else if (key === "diet") payload = { meal, text, kcal: null };
      else if (key === "people") payload = { name: text, type: pType };
      try {
        await onManual(key, payload);
      } catch {
        return; // 失败已由 onManual notify
      }
      setManualDomain(null);
      setText("");
      setYuan("");
      setMood("");
    } finally {
      setBusy(false);
    }
  }

  function manualForm(key: SixKey) {
    const wrap = (label: string, node: React.ReactNode) => (
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] text-ink-dim">{label}</span>
        {node}
      </label>
    );
    switch (key) {
      case "schedule":
        return (
          <div className="space-y-1.5">
            {wrap("事项", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="做了什么" className={inputCls} />)}
            <div className="flex items-end gap-1.5">
              {wrap("开始", <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} w-24 flex-none`} />)}
              {wrap("结束", <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`${inputCls} w-24 flex-none`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={`${btnMini} mb-0.5`}>
                <Plus size={12} /> 添加
              </button>
            </div>
          </div>
        );
      case "todo":
        return (
          <div className="space-y-1.5">
            {wrap("todo", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="要做什么" className={inputCls} />)}
            <div className="flex items-end gap-1.5">
              {wrap("截止（可空）", <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${inputCls} flex-1`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={`${btnMini} mb-0.5`}>
                <Plus size={12} /> 添加
              </button>
            </div>
          </div>
        );
      case "finance":
        return (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {wrap(
                "类型",
                <select value={direction} onChange={(e) => setDirection(e.target.value)} className={inputCls}>
                  <option value="out">支出</option>
                  <option value="in">收入</option>
                </select>,
              )}
              {wrap(
                "类别",
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "医疗", "居住", "其他"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>,
              )}
            </div>
            <div className="flex items-end gap-1.5">
              {wrap("金额（元）", <input type="number" min="0" step="0.01" value={yuan} onChange={(e) => setYuan(e.target.value)} className={`${inputCls} w-24 flex-none`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !yuan} className={`${btnMini} mb-0.5`}>
                <Plus size={12} /> 添加
              </button>
            </div>
          </div>
        );
      case "mood":
        return (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {COMMON_MOODS.map((w: string) => (
                <button
                  key={w}
                  onClick={() => setMood(w)}
                  className={`rounded-full px-2.5 py-1.5 text-[11px] ${mood === w ? "bg-sky-600 text-white" : "bg-soft/60 text-ink-soft hover:bg-strong"}`}
                >
                  {w}
                </button>
              ))}
            </div>
            <button onClick={() => submitManual(key)} disabled={busy || !mood} className={btnMini}>
              <Plus size={12} /> 添加
            </button>
          </div>
        );
      case "diet":
        return (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {wrap(
                "餐次",
                <select value={meal} onChange={(e) => setMeal(e.target.value)} className={inputCls}>
                  {["早餐", "午餐", "晚餐", "加餐", "夜宵"].map((x) => <option key={x}>{x}</option>)}
                </select>,
              )}
              {wrap("吃了什么", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="如 牛肉面一碗" className={inputCls} />)}
            </div>
            <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={btnMini}>
              <Plus size={12} /> 添加
            </button>
          </div>
        );
      case "people":
        return (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {wrap("姓名", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="和谁在一起" className={inputCls} />)}
              {wrap(
                "类型",
                <select value={pType} onChange={(e) => setPType(e.target.value)} className={inputCls}>
                  {["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"].map((x) => <option key={x}>{x}</option>)}
                </select>,
              )}
            </div>
            <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={btnMini}>
              <Plus size={12} /> 添加
            </button>
          </div>
        );
    }
  }

  return (
    /* 移动端：底部弹层（拇指可达、不溢出视口）；桌面（sm:）：锚定卡片的浮层 */
    <div
      ref={useDismiss<HTMLDivElement>(onClose)}
      className="fade-up fixed inset-x-0 bottom-0 z-[60] max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-4 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:max-h-none sm:w-[300px] sm:rounded-xl sm:p-3"
      style={desktopPos ? { top: desktopPos.top, left: desktopPos.left } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 移动端拖拽指示条 */}
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Sparkles size={13} className="text-ai" /> 识别与补充
        </span>
        <button onClick={onClose} title="关闭" className="rounded p-1 text-ink-dim hover:bg-wash hover:text-ink">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-0.5">
        {SIX.map(({ key, icon: Icon, label, hint }) => {
          const st = domainState(m, key as SixKey);
          const isManual = manualDomain === key;
          return (
            <div key={key} className={`rounded-lg ${isManual ? "border border-sky-500/40 bg-elevated/60 p-2" : ""}`}>
              <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-wash">
                <button
                  onClick={() => onAI(key)}
                  disabled={busyDomain === key}
                  title={`AI 识别${label}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${st === "applied" ? "bg-emerald-500/15 text-success" : "bg-soft/50 text-ink-mute"}`}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-ink">{label}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{hint}</span>
                  </span>
                  {busyDomain === key ? (
                    <span className="shrink-0 animate-pulse text-[10px] text-accent">识别中…</span>
                  ) : st === "applied" ? (
                    <span className="shrink-0 text-success"><Check size={14} /></span>
                  ) : null}
                </button>
                <button
                  onClick={() => openManual(key)}
                  title={`手动添加${label}`}
                  className={`shrink-0 rounded-lg p-1.5 transition ${
                    isManual ? "bg-sky-600 text-white" : "text-ink-dim hover:bg-wash hover:text-accent"
                  }`}
                >
                  <PencilLine size={13} />
                </button>
              </div>
              {isManual && <div className="mt-1 border-t border-line/60 pt-2">{manualForm(key)}</div>}
            </div>
          );
        })}
      </div>

      {/* 所属空间（REQ-001 R3）：单选归属 / 移除；spaceMenu 列表由父级挂载时拉取 */}
      <div className="mt-2 border-t border-line-soft pt-2">
        <span className="text-[11px] font-semibold text-ink">所属空间</span>
        {spaceMenu === null ? (
          <button
            onClick={() => {
              fetch("/api/spaces")
                .then((r) => r.json())
                .then((j) => setSpaceMenu((j.spaces ?? []).filter((s: { status: string }) => s.status === "active")))
                .catch(() => setSpaceMenu([]));
            }}
            className="mt-1 block text-[11px] text-accent hover:underline"
          >
            选择归属…
          </button>
        ) : (
          <div className="mt-1 space-y-0.5">
            {spaceMenu.length === 0 && <p className="text-[10px] text-ink-faint">还没有进行中的空间</p>}
            {spaceMenu.map((s: { id: string; name: string; icon: string; color: string }) => (
              <button
                key={s.id}
                onClick={() => {
                  void onSetSpace(s.id);
                  onClose();
                }}
                className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px] transition hover:bg-wash ${
                  m.space?.id === s.id ? "font-medium text-accent" : "text-ink-soft"
                }`}
              >
                <span>{s.icon}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {m.space?.id === s.id && <Check size={12} />}
              </button>
            ))}
            {m.space && (
              <button
                onClick={() => {
                  void onSetSpace(null);
                  onClose();
                }}
                className="w-full rounded-lg px-1.5 py-1 text-left text-[11px] text-danger hover:bg-wash"
              >
                移除归属
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 flex items-center gap-1.5 border-t border-line-soft pt-2 text-[10px] leading-relaxed text-ink-dim">
        <Sparkles size={10} className="shrink-0 text-ai" /> 点行 = AI 识别该类
        <PencilLine size={10} className="ml-1 shrink-0 text-accent" /> 点 ✏️ = 手动补充
      </p>
    </div>
  );
}
