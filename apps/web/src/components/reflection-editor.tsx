"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import MarkdownView from "./markdown-view";
import { applyMarkdownControlled, handleMarkdownKey, type MdKind } from "./markdown-shortcuts";
import { useBodyScrollLock } from "@/components/ui/use-body-scroll-lock";
import { useDismiss } from "./dismissable";

/**
 * N2 感悟编辑器（REQ-002 FR-N2.2/2.3）：底部抽屉，自适应 textarea + 字数（码点口径，与 DB char_length 一致）。
 * 超限禁存；取消（点空白/Esc/×）时若有改动 → 轻提示「已取消，未保存」（N3.5）。
 */
export default function ReflectionEditor({
  open,
  initial,
  busy,
  notify,
  onCancel,
  onSave,
}: {
  open: boolean;
  /** 编辑模式回填全文；新建传 "" */
  initial: string;
  busy: boolean;
  /** N3.5 取消且有改动时的轻提示 */
  notify?: (m: { ok: boolean; text: string } | null) => void;
  onCancel: () => void;
  onSave: (content: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const initialRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setValue(initial);
    initialRef.current = initial;
    const t = setTimeout(() => taRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, initial]);

  // deps 含 value：cancel 随击键换新引用，useDismiss 的 effect 相应每键重订阅
  // （开销可忽略，闭包恒最新；旧注释宣称「稳定化不重订阅」与实现相反，已如实更正）
  const cancel = useCallback(() => {
    // N3.5：有改动时轻提示「已取消，未保存」（不弹确认，保持轻量）
    if (value !== initialRef.current) notify?.({ ok: true, text: "已取消，未保存" });
    onCancel();
  }, [value, notify, onCancel]);

  // busy（保存进行中）禁用 Esc/点外关闭：慢网期间被关闭会让保存反馈丢失（与 Modal busy 同口径）
  const panelRef = useDismiss<HTMLDivElement>(cancel, open && !busy);
  // body 滚动锁：抽屉打开期间锁背景滚动，关闭/卸载还原
  useBodyScrollLock(open);
  if (!open) return null;

  const chars = Array.from(value).length; // 码点计数，与 DB char_length 同口径
  const over = chars > 50_000;
  async function save() {
    if (over || busy || !value.trim()) return;
    const ok = await onSave(value.trim());
    if (ok) initialRef.current = value.trim();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={panelRef}
        className="glass safe-bottom flex max-h-[88dvh] w-full flex-col rounded-t-2xl p-5 sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{initialRef.current ? "编辑感悟" : "写感悟"}</h3>
            {/* 编辑 | 预览 切换（markdown 实时渲染） */}
            <div className="flex overflow-hidden rounded-lg border border-line-soft text-micro">
              <button
                onClick={() => setTab("edit")}
                className={`px-2.5 py-1 transition ${tab === "edit" ? "bg-sky-500/15 text-accent" : "text-ink-mute hover:text-ink"}`}
              >
                编辑
              </button>
              <button
                onClick={() => setTab("preview")}
                className={`px-2.5 py-1 transition ${tab === "preview" ? "bg-sky-500/15 text-accent" : "text-ink-mute hover:text-ink"}`}
              >
                预览
              </button>
            </div>
          </div>
          <button onClick={cancel} disabled={busy} aria-label="关闭" className="rounded p-1 text-ink-dim hover:text-ink disabled:opacity-40"><X size={14} /></button>
        </div>
        {tab === "preview" ? (
          <div className="min-h-[40vh] w-full flex-1 overflow-y-auto rounded-xl border border-line-soft bg-surface/60 px-3 py-2.5">
            {value.trim() ? (
              <MarkdownView value={value} />
            ) : (
              <p className="text-xs text-ink-faint">暂无内容 —— 回到「编辑」写点什么</p>
            )}
          </div>
        ) : (
          <>
            {/* Markdown 工具栏（REQ-019 FR-B2）：按钮与 Ctrl/Cmd+B/I/K 快捷键共用同一变换 */}
            <div className="mb-1.5 flex items-center gap-0.5" role="toolbar" aria-label="Markdown 格式">
              {([
                ["bold", "B", "加粗（Ctrl/⌘+B）", "font-bold"],
                ["italic", "I", "斜体（Ctrl/⌘+I）", "italic"],
                ["h2", "H2", "标题", ""],
                ["list", "•", "列表", ""],
                ["quote", "❝", "引用", ""],
                ["link", "🔗", "链接（Ctrl/⌘+K）", ""],
              ] as [MdKind, string, string, string][]).map(([kind, label, title, extra]) => (
                <button
                  key={kind}
                  type="button"
                  title={title}
                  onClick={() => taRef.current && applyMarkdownControlled(taRef.current, kind, setValue)}
                  className={`rounded-md px-2 py-1 text-xs text-ink-mute transition hover:bg-soft hover:text-ink ${extra}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={value}
              onKeyDown={(e) => {
                if (taRef.current && handleMarkdownKey(taRef.current, e)) return;
              }}
              onChange={(e) => {
                const next = e.target.value;
                // length ≥ 码点数：未超限不做 O(n) 码点展开（5 万字长文每键全展开是纯浪费）
                if (next.length > 50_000 && [...next].length > 50_000) {
                  setValue(Array.from(next).slice(0, 50_000).join(""));
                  return;
                }
                setValue(next);
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted && (value + pasted).length > 50_000 && [...(value + pasted)].length > 50_000) {
                  e.preventDefault();
                  const merged = Array.from(value + pasted).slice(0, 50_000).join("");
                  setValue(merged);
                }
              }}
              placeholder="记录阶段心得、踩坑复盘、自我对话……（支持 Markdown：# 标题、**粗体**、列表、表格、代码，单篇 ≤50000 字）"
              className="input-glow min-h-[40vh] w-full flex-1 resize-none rounded-xl border border-line-soft bg-surface/60 px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-ink-faint"
            />
          </>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={`text-micro tabular-nums ${over ? "text-danger" : chars > 45_000 ? "text-warn" : "text-ink-faint"}`}>
            {chars}/50000{over ? " · 超出上限" : ""}
          </span>
          <div className="flex gap-2">
            <button onClick={cancel} className="rounded-xl px-4 py-2 text-xs text-ink-mute hover:bg-soft">
              取消
            </button>
            <button
              onClick={() => void save()}
              disabled={busy || over || !value.trim()}
              className="btn-primary rounded-xl px-5 py-2 text-xs font-medium disabled:opacity-50"
              title={over ? "超出 50000 字上限" : ""}
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
