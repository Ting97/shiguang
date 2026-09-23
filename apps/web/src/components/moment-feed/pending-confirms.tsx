"use client";

import type { FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import { DOMAIN_LABELS } from "./kit";
import type { RunFn } from "./types";

interface PendingConfirmsProps {
  m: FeedMoment;
  run: RunFn;
}

/** 待确认的低置信识别（识别登记簿 pending）：逐域确认入账 / 忽略 */
export function PendingConfirms({ m, run }: PendingConfirmsProps) {
  // 低置信待确认域（识别登记簿 pending）
  const pendingDomains = (Object.entries(m.recognitions ?? {}) as [string, { status: string; confidence: number }][])
    .filter(([, v]) => v.status === "pending")
    .map(([domain, v]) => ({ domain, confidence: v.confidence }));

  if (pendingDomains.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {pendingDomains.map((d) => (
        <div key={d.domain} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-[11px] text-warn/90">
          <span>🤔 识别到{DOMAIN_LABELS[d.domain] ?? d.domain}（置信度 {Math.round((d.confidence ?? 0) * 100)}%），确认吗？</span>
          <button
            onClick={() => run(async () => { await api(`/api/entries/${m.id}/confirm`, "POST", { domain: d.domain }); return "✅ 已确认入账"; })}
            className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-500"
          >
            确认
          </button>
          <button
            onClick={() => run(async () => { await api(`/api/entries/${m.id}/confirm`, "POST", { domain: d.domain, ignore: true }); return "已忽略"; })}
            className="rounded px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink"
          >
            忽略
          </button>
        </div>
      ))}
    </div>
  );
}
