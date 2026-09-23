"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { TYPE_EMOJI, type InteractionType } from "@/lib/social";
import { api } from "@/shared/api"; // 统一走 401 收口层：会话失效跳 /login（裸 client-api 不跳）

export function InteractionFormModal({
  contactName,
  onClose,
  onSaved,
}: {
  contactName: string;
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const params2 = useParams<{ id: string }>();
  const id = !params2.id || params2.id === "__shell__"
    ? (typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean)[1] ?? "" : "")
    : params2.id;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [type, setType] = useState<InteractionType>("见面");
  const [summary, setSummary] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl sm:max-w-md sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">补一笔往来 · {contactName}</h3>
          <button onClick={onClose} className="rounded px-2 text-ink-dim hover:text-ink">✕</button>
        </div>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as InteractionType)}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
            >
              {(Object.keys(TYPE_EMOJI) as InteractionType[]).map((t) => (
                <option key={t} value={t}>{TYPE_EMOJI[t]} {t}</option>
              ))}
            </select>
            <input
              autoFocus
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              type="datetime-local"
              className="flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
            />
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="记点什么（如：一起看了场电影）"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">
              取消
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await api(`/api/contacts/${id}/interactions`, "POST", {
                    type,
                    summary,
                    occurredAt: when ? new Date(when).toISOString() : undefined,
                  });
                  await onSaved("🤝 已补记一笔往来");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {busy ? "保存中…" : "记入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
