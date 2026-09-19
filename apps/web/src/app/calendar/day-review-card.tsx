"use client";

import { useState } from "react";

/** AI 日小结（Phase 4 复盘引擎 MVP）：聚合当天真实记录 → LLM 解读；不落库，点按钮即时生成 */
export default function DayReviewCard({ date, hasRecords, notify }: {
  date: string;
  hasRecords: boolean;
  notify: (e: string | null) => void;
}) {
  const [review, setReview] = useState<{ summary: string; highlights: string[]; suggestions: string[] } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/review/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, refresh: review != null }), // 已有结果时点「重新生成」才强制刷新
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
        <h3 className="shrink-0 text-xs font-semibold text-ink-mute">✨ AI 日小结{generatedAt && <span className="ml-2 text-[10px] font-normal text-ink-faint">生成于 {generatedAt.slice(5, 16).replace("T", " ")}</span>}</h3>
        <button
          onClick={generate}
          disabled={busy || !hasRecords}
          title={hasRecords ? "基于当天真实记录生成" : "当天还没有记录"}
          className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[11px] text-ai transition hover:bg-purple-500/20 disabled:opacity-40"
        >
          {busy ? "解读中…" : review ? "重新生成" : "生成小结"}
        </button>
      </div>
      {busy && <p className="mt-2 animate-pulse text-[11px] text-ai/80">正在通读当天记录…</p>}
      {!busy && !review && !hasRecords && <p className="mt-2 text-[11px] text-ink-faint">当天还没有记录</p>}
      {!busy && !review && hasRecords && <p className="mt-2 text-[11px] text-ink-faint">让 AI 通读当天的时间/待办/收支/人际，写一份小结</p>}
      {!busy && review && (
        <div className="mt-2 space-y-2">
          <p className="text-xs leading-relaxed text-ink">{review.summary}</p>
          {review.highlights.length > 0 && (
            <ul className="space-y-1">
              {review.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-[11px] text-success/90"><span className="shrink-0">💚</span><span>{h}</span></li>
              ))}
            </ul>
          )}
          {review.suggestions.length > 0 && (
            <ul className="space-y-1">
              {review.suggestions.map((sg) => (
                <li key={sg} className="flex gap-1.5 text-[11px] text-accent/90"><span className="shrink-0">💡</span><span>{sg}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
