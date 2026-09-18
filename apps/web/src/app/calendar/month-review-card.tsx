"use client";

import { useState } from "react";

/** AI 月报（Phase 4 复盘引擎）：聚合本月真实记录 → LLM 解读；不落库，点按钮即时生成 */
export default function MonthReviewCard({ month, hasRecords, notify }: {
  month: string; // YYYY-MM
  
  hasRecords: boolean;
  notify: (e: string | null) => void;
}) {
  const [review, setReview] = useState<{ summary: string; highlights: string[]; suggestions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/review/month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
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
        <h2 className="text-sm font-semibold text-slate-300">
          ✨ AI 月报
          <span className="ml-2 text-[11px] font-normal text-slate-500">{Number(month.slice(5))} 月</span>
        </h2>
        <button
          onClick={generate}
          disabled={busy || !hasRecords}
          title={hasRecords ? "基于本周真实记录生成" : "本月还没有记录"}
          className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-300 transition hover:bg-purple-500/20 disabled:opacity-40"
        >
          {busy ? "解读中…" : review ? "重新生成" : "生成本月小结"}
        </button>
      </div>
      {busy && <p className="mt-3 animate-pulse text-xs text-purple-300/80">正在通读本月的时间/待办/收支/人际…</p>}
      {!busy && !review && !hasRecords && <p className="mt-3 text-xs text-slate-600">本周还没有记录</p>}
      {!busy && !review && hasRecords && (
        <p className="mt-3 text-xs text-slate-600">让 AI 通读本周的时间投入/待办/收支/人际，总结这一个月</p>
      )}
      {!busy && review && (
        <div className="mt-3 space-y-2">
          <p className="text-sm leading-relaxed text-slate-200">{review.summary}</p>
          {review.highlights.length > 0 && (
            <ul className="space-y-1">
              {review.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-xs text-emerald-200/90"><span className="shrink-0">💚</span><span>{h}</span></li>
              ))}
            </ul>
          )}
          {review.suggestions.length > 0 && (
            <ul className="space-y-1">
              {review.suggestions.map((sg) => (
                <li key={sg} className="flex gap-1.5 text-xs text-sky-200/90"><span className="shrink-0">💡</span><span>{sg}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
