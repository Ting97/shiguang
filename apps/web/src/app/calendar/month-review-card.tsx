"use client";

import { useState } from "react";
import { useCachedReview } from "./use-cached-review";
import { TagChip } from "@/components/tag-chip";

/** AI 月报（review v3）：挂载时展示上次持久化的小结；点按钮生成/重新生成；分节长文渲染 */
export default function MonthReviewCard({ month, hasRecords, notify }: {
  month: string; // YYYY-MM

  hasRecords: boolean;
  notify: (e: string | null) => void;
}) {
  const cached = useCachedReview("month", month);
  const [review, setReview] = useState<{
    summary: string; sections?: { title: string; text: string }[]; highlights: string[]; suggestions: string[];
  } | null>(null);
  const [_generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = review ?? cached;

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/review/month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, refresh: shown != null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setGeneratedAt(j.generatedAt ?? null);
      setReview(j.review);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass mt-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">
          <TagChip icon="✨" label="AI 月报" tone="violet" size="sm" />
          <span className="ml-2 text-[11px] font-normal text-ink-dim">{Number(month.slice(5))} 月</span>
        </h2>
        <button
          onClick={generate}
          disabled={busy || !hasRecords}
          title={hasRecords ? "基于本月真实记录生成" : "本月还没有记录"}
          className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs text-ai transition hover:bg-purple-500/20 disabled:opacity-40"
        >
          {busy ? "解读中…" : shown ? "重新生成" : "生成本月小结"}
        </button>
      </div>
      {busy && <p className="mt-3 animate-pulse text-xs text-ai/80">正在通读本月的时间/todo/收支/人际…</p>}
      {!busy && !shown && !hasRecords && <p className="mt-3 text-xs text-ink-faint">本月还没有记录</p>}
      {!busy && !shown && hasRecords && (
        <p className="mt-3 text-xs text-ink-faint">让 AI 通读本月的时间投入/todo/收支/人际，总结这一个月</p>
      )}
      {!busy && shown && (
        <div className="mt-3 space-y-2">
          <p className="text-sm leading-relaxed text-ink">{shown.summary}</p>
          {(shown.sections ?? []).map((s) => (
            <div key={s.title}>
              <h3 className="text-xs font-semibold text-ink-soft">▎{s.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{s.text}</p>
            </div>
          ))}
          {(shown.highlights ?? []).length > 0 && (
            <ul className="space-y-1">
              {shown.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-xs text-success/90"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success/80"></span><span>{h}</span></li>
              ))}
            </ul>
          )}
          {(shown.suggestions ?? []).length > 0 && (
            <ul className="space-y-1">
              {shown.suggestions.map((sg) => (
                <li key={sg} className="flex gap-1.5 text-xs text-accent/90"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-violet-500/15 text-[9px] leading-none text-ai">💡</span><span>{sg}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
