"use client";

import { useState } from "react";
import type { Activity, FeedMoment } from "@/lib/types";
import { COMMON_MOODS } from "./moment-feed";

const SIX = [
  { key: "schedule", icon: "🕒", label: "日程", hint: "做了什么事" },
  { key: "todo", icon: "📋", label: "待办", hint: "之后要做" },
  { key: "finance", icon: "💰", label: "收支", hint: "花了/收入" },
  { key: "mood", icon: "😊", label: "心情", hint: "此刻情绪" },
  { key: "people", icon: "👥", label: "关系", hint: "和谁在一起" },
  { key: "diet", icon: "🍽", label: "饮食", hint: "吃了什么" },
] as const;

type SixKey = (typeof SIX)[number]["key"];

interface Props {
  m: FeedMoment;
  activities: Activity[];
  busyDomain: string | null;
  onAI: (domain: string) => void;
  onManual: (domain: SixKey, payload: Record<string, unknown>) => void | Promise<void>;
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
  "min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-sky-500";
const btnMini = "shrink-0 rounded-md bg-sky-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-sky-500";

/** 识别菜单浮层：六域（AI 识别 / 手动添加） */
export default function EntryMenu({ m, activities, busyDomain, onAI, onManual, onClose }: Props) {
  const [manualDomain, setManualDomain] = useState<SixKey | null>(null);
  const [busy, setBusy] = useState(false);

  // 手动表单通用状态
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
        <span className="text-[10px] text-slate-500">{label}</span>
        {node}
      </label>
    );
    switch (key) {
      case "schedule":
        return (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {wrap("事项", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="做了什么" className={inputCls} />)}
            </div>
            <div className="flex items-center gap-1.5">
              {wrap("开始", <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} w-20 flex-none`} />)}
              {wrap("结束", <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`${inputCls} w-20 flex-none`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={`${btnMini} mt-2`}>添加</button>
            </div>
          </div>
        );
      case "todo":
        return (
          <div className="space-y-1.5">
            {wrap("待办事项", <input value={text} onChange={(e) => setText(e.target.value)} placeholder="要做什么" className={inputCls} />)}
            <div className="flex items-center gap-1.5">
              {wrap("截止（可空）", <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${inputCls} flex-1`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={`${btnMini} mt-2`}>添加</button>
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
            <div className="flex items-center gap-1.5">
              {wrap("金额（元）", <input type="number" min="0" step="0.01" value={yuan} onChange={(e) => setYuan(e.target.value)} className={`${inputCls} w-24 flex-none`} />)}
              <button onClick={() => submitManual(key)} disabled={busy || !yuan} className={`${btnMini} mt-2`}>添加</button>
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
                  className={`rounded-full px-2 py-1 text-[11px] ${mood === w ? "bg-sky-600 text-white" : "bg-slate-700/60 text-slate-300 hover:bg-slate-600"}`}
                >
                  {w}
                </button>
              ))}
            </div>
            <button onClick={() => submitManual(key)} disabled={busy || !mood} className={btnMini}>添加</button>
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
            <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={btnMini}>添加</button>
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
            <button onClick={() => submitManual(key)} disabled={busy || !text.trim()} className={btnMini}>添加</button>
          </div>
        );
    }
  }

  return (
    <div
      className="glass absolute right-2 top-9 z-40 w-[288px] max-w-[calc(100vw-3.5rem)] rounded-xl p-3 shadow-2xl shadow-slate-950/70 fade-up"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">识别与补充</span>
        <button onClick={onClose} className="rounded px-1.5 text-xs text-slate-500 hover:text-slate-200">✕</button>
      </div>

      <div className="space-y-0.5">
        {SIX.map(({ key, icon, label, hint }) => {
          const st = domainState(m, key as SixKey);
          const isManual = manualDomain === key;
          return (
            <div key={key} className={`rounded-lg ${isManual ? "border border-sky-500/40 bg-slate-800/60 p-2" : ""}`}>
              <div className="group/row flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/5">
                <button
                  onClick={() => onAI(key)}
                  disabled={busyDomain === key}
                  title={`AI 识别${label}`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-base">{icon}</span>
                  <span className="shrink-0 text-xs text-slate-200">{label}</span>
                  <span className="truncate text-[10px] text-slate-600">{hint}</span>
                  {busyDomain === key ? (
                    <span className="ml-auto shrink-0 animate-pulse text-[10px] text-sky-300">识别中</span>
                  ) : st === "applied" ? (
                    <span className="ml-auto shrink-0 text-[10px] text-emerald-400">✓ 已识别</span>
                  ) : (
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">未识别</span>
                  )}
                </button>
                <button
                  onClick={() => openManual(key)}
                  title={`手动添加${label}`}
                  className={`shrink-0 rounded px-1.5 py-1 text-[10px] transition ${
                    isManual ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-white/5 hover:text-sky-300"
                  }`}
                >
                  ✏️
                </button>
              </div>
              {isManual && (
                <div className="mt-1 border-t border-slate-700/60 pt-2">
                  {manualForm(key)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-600">
        点行 = ✨ AI 识别该类 · 点 ✏️ = 手动补充
      </p>
    </div>
  );
}
