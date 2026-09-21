"use client";

import { useState } from "react";
import { useCachedReview } from "./use-cached-review";
import { TagChip } from "@/components/tag-chip";

/** AI 日小结（review v3）：挂载时展示上次持久化的小结；点按钮生成/重新生成 */
export default function DayReviewCard({ date, hasRecords, notify }: {
  date: string;
  hasRecords: boolean;
  notify: (e: string | null) => void;
}) {
  const cached = useCachedReview("day", date);
  const [review, setReview] = useState<{ summary: string; highlights: string[]; suggestions: string[] } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = review ?? cached; // 本次会话生成结果优先，否则用上次持久化的小结

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/review/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, refresh: shown != null }), // 已有小结（含上次持久化的）时点「重新生成」强制刷新
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
    <div className="mt-4 border-t border-line-soft pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex shrink-0 items-center gap-2 text-xs font-semibold text-ink-mute"><TagChip icon="✨" label="AI 日小结" tone="violet" size="sm" />{(generatedAt && review) && <span className="ml-2 text-[10px] font-normal text-ink-faint">生成于 {generatedAt.slice(5, 16).replace("T", " ")}</span>}</h3>
        <button
          onClick={generate}
          disabled={busy || !hasRecords}
          title={hasRecords ? "基于当天真实记录生成" : "当天还没有记录"}
          className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[11px] text-ai transition hover:bg-purple-500/20 disabled:opacity-40"
        >
          {busy ? "解读中…" : shown ? "重新生成" : "生成小结"}
        </button>
      </div>
      {busy && <p className="mt-2 animate-pulse text-[11px] text-ai/80">正在通读当天记录…</p>}
      {!busy && !shown && !hasRecords && <p className="mt-2 text-[11px] text-ink-faint">当天还没有记录</p>}
      {!busy && !shown && hasRecords && <p className="mt-2 text-[11px] text-ink-faint">让 AI 通读当天的时间/待办/收支/人际，写一份小结</p>}
      {!busy && shown && (
        <div className="mt-2 space-y-2">
          <p className="text-xs leading-relaxed text-ink">{shown.summary}</p>
          {(shown.highlights ?? []).length > 0 && (
            <ul className="space-y-1">
              {shown.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-[11px] text-success/90"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success/80"></span><span>{h}</span></li>
              ))}
            </ul>
          )}
          {(shown.suggestions ?? []).length > 0 && (
            <ul className="space-y-1">
              {shown.suggestions.map((sg) => (
                <li key={sg} className="flex gap-1.5 text-[11px] text-accent/90"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-violet-500/15 text-[9px] leading-none text-ai">💡</span><span>{sg}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
