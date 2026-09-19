"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/nav";
import Skeleton from "@/components/skeleton";
import ContactFormModal from "@/components/contact-form";
import { api } from "@/lib/client-api";
import { GROUP_EMOJI, TYPE_EMOJI, birthdayLabel, displaySummary, importanceLabel, type InteractionType } from "@/lib/social";

interface Contact {
  id: string;
  name: string;
  alias: string | null;
  group_tag: string;
  birthday: string | null;
  anniversary: string | null;
  intimacy: number;
  importance: number;
  notes: string | null;
  created_at: string;
  ai_profile: { summary: string; likes: string[]; dislikes: string[]; facts: string[] } | null;
  ai_profile_at: string | null;
}
interface TimelineItem {
  id: string;
  type: InteractionType | string;
  summary: string | null;
  occurred_at: string | null;
  created_at: string;
  entry_text: string | null;
  tx_amount_cents: number | null;
  tx_direction: "out" | "in" | null;
  tx_category: string | null;
}
interface MoneyItem {
  id: string;
  direction: "out" | "in";
  amount_cents: number;
  category: string;
  note: string | null;
  occurred_at: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const zhDay = (iso: string) => {
  const d = new Date(iso);
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86_400_000);
  const label = diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return label;
};
const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [money, setMoney] = useState<MoneyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [profiling, setProfiling] = useState(false); // AI 交往画像生成中

  const load = useCallback(async () => {
    const j = await api(`/api/contacts/${id}`, "GET");
    setContact(j.contact ?? null);
    setTimeline(j.timeline ?? []);
    setMoney(j.money ?? []);
  }, [id]);

  async function runProfile() {
    if (profiling) return;
    setProfiling(true);
    try {
      const j = await api(`/api/contacts/${id}/ai-profile`, "POST");
      setContact((c) => (c ? { ...c, ai_profile: j.profile, ai_profile_at: new Date().toISOString() } : c));
      setMsg({ ok: true, text: "✨ 交往画像已更新" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setProfiling(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  if (loading) {
    return (
      <main className="min-h-screen text-slate-100">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Nav />
          <Skeleton rows={3} className="py-2" />
        </div>
      </main>
    );
  }
  if (!contact) {
    return (
      <main className="min-h-screen text-slate-100">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Nav />
          <p className="py-16 text-center text-xs text-slate-500">联系人不存在</p>
        </div>
      </main>
    );
  }

  const bd = birthdayLabel(contact.birthday);
  const giftIn = money.filter((m) => m.direction === "in").reduce((s, m) => s + m.amount_cents, 0);
  const giftOut = money.filter((m) => m.direction === "out").reduce((s, m) => s + m.amount_cents, 0);

  async function removeContact() {
    if (!window.confirm(`删除「${contact!.name}」的档案？\n往来时间线将一并删除，动态与流水不受影响。`)) return;
    try {
      await api(`/api/contacts/${contact!.id}`, "DELETE");
      router.push("/contacts");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />

        <Link href="/contacts" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-sky-300">
          ← 返回人际
        </Link>

        {/* 档案头卡 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 text-2xl">
              {GROUP_EMOJI[contact.group_tag] ?? "👤"}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-baseline gap-2 text-xl font-bold text-slate-100">
                {contact.name}
                {contact.alias && <span className="text-sm font-normal text-slate-500">（{contact.alias}）</span>}
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">{contact.group_tag}</span>
                <span className="rounded bg-gradient-to-r from-sky-500/20 to-indigo-500/20 px-1.5 py-0.5 text-[10px] font-normal text-sky-300">
                  {importanceLabel(contact.importance)}
                </span>
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                {bd && (
                  <span>
                    🎂 生日 {bd.date}
                    {bd.countdown && <span className="ml-1 text-pink-300">· {bd.countdown}</span>}
                  </span>
                )}
                {contact.anniversary && <span>💞 纪念日 {contact.anniversary.slice(5).replace("-", "月")}日</span>}
                <span>📅 {timeline.length} 次往来</span>
                {money.length > 0 && (
                  <span className="tabular-nums">
                    💰 收 {yuan(giftIn)} / 送 {yuan(giftOut)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => setEditing(true)} title="编辑档案" className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300">
                ✏️
              </button>
              <button onClick={removeContact} title="删除联系人" className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300">
                🗑
              </button>
            </div>
          </div>
          {/* 亲密度 */}
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>亲密度</span>
              <span className="tabular-nums">{contact.intimacy}/100</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-pink-400 transition-all duration-500"
                style={{ width: `${contact.intimacy}%` }}
              />
            </div>
          </div>
          {contact.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs leading-relaxed text-slate-300">
              {contact.notes}
            </p>
          )}
        </section>

        {/* AI 交往画像（W10）：基于往来记录提炼喜好/忌讳/重要事实 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              ✨ AI 交往画像
              {contact.ai_profile_at && (
                <span className="ml-2 text-[11px] font-normal text-slate-500">提炼于 {contact.ai_profile_at}</span>
              )}
            </h2>
            <button
              onClick={runProfile}
              disabled={profiling}
              className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 transition hover:bg-purple-500/20 disabled:opacity-50"
            >
              {profiling ? "提炼中…" : contact.ai_profile ? "重新提炼" : "提炼交往画像"}
            </button>
          </div>
          {profiling && <p className="mt-3 animate-pulse text-xs text-purple-300/80">正在通读往来记录，总结喜好 / 忌讳 / 值得记住的事…</p>}
          {!profiling && !contact.ai_profile && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              让 AI 通读与 TA 的往来记录和人情账，提炼交往风格、喜好与忌讳 —— 见面前扫一眼。
            </p>
          )}
          {!profiling && contact.ai_profile && (
            <div className="mt-3 space-y-2.5">
              <p className="text-sm leading-relaxed text-slate-200">{contact.ai_profile.summary}</p>
              {contact.ai_profile.likes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-emerald-300/80">💚 喜欢</span>
                  {contact.ai_profile.likes.map((x) => (
                    <span key={x} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">{x}</span>
                  ))}
                </div>
              )}
              {contact.ai_profile.dislikes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-rose-300/80">⚠️ 忌讳</span>
                  {contact.ai_profile.dislikes.map((x) => (
                    <span key={x} className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">{x}</span>
                  ))}
                </div>
              )}
              {contact.ai_profile.facts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-sky-300/80">📌 记住</span>
                  {contact.ai_profile.facts.map((x) => (
                    <span key={x} className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">{x}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {msg && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
              msg.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 一起经历过的事 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              🕐 一起经历过的事
              <span className="ml-2 text-xs font-normal text-slate-500">来自动态识别 + 手动补记</span>
            </h2>
            <button onClick={() => setAdding(true)} className="whitespace-nowrap rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20">
              ＋ 补一笔往来
            </button>
          </div>
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-600">
              还没有往来记录 —— 动态里提到「{contact.name}」会自动记入，或点右上角补一笔
            </p>
          ) : (
            <ol className="relative space-y-4">
              {timeline.map((t, idx) => {
                const when = t.occurred_at ?? t.created_at;
                return (
                  <li key={t.id} className="relative flex gap-3">
                    {idx < timeline.length - 1 && (
                      <span className="absolute left-[13px] top-7 -bottom-2 w-px bg-gradient-to-b from-sky-500/40 to-indigo-500/10" />
                    )}
                    <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm">
                      {TYPE_EMOJI[t.type as InteractionType] ?? "•"}
                    </span>
                    <div className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{t.type}</span>
                        <span className="shrink-0 tabular-nums text-slate-500">{zhDay(when)}</span>
                        {t.tx_amount_cents != null && (
                          <span className={`shrink-0 tabular-nums ${t.tx_direction === "out" ? "text-rose-300" : "text-emerald-300"}`}>
                            {t.tx_direction === "out" ? "送出" : "收到"} {yuan(t.tx_amount_cents)}
                          </span>
                        )}
                      </div>
                      {t.summary && <p className="mt-1 text-sm text-slate-200">{displaySummary(t.summary)}</p>}
                      {t.entry_text && t.entry_text !== t.summary && (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">「{t.entry_text}」</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 关联人情账 */}
        {money.length > 0 && (
          <section className="glass rounded-2xl p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">
              💰 关联人情账
              <span className="ml-2 text-xs font-normal text-slate-500">流水中「对方」为 TA 的人情往来 · 净额 {yuan(giftIn - giftOut)}</span>
            </h2>
            <ul className="space-y-1">
              {money.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${m.direction === "out" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                    {m.direction === "out" ? "送" : "收"}
                  </span>
                  <span className="flex-1 truncate text-xs text-slate-300">{m.note || m.category}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{zhDay(m.occurred_at)}</span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${m.direction === "out" ? "text-rose-300" : "text-emerald-300"}`}>
                    {m.direction === "out" ? "-" : "+"}
                    {yuan(m.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {editing && (
          <ContactFormModal
            initial={contact}
            onClose={() => setEditing(false)}
            onSaved={async (text) => {
              setEditing(false);
              setMsg({ ok: true, text });
              await load();
            }}
          />
        )}

        {adding && (
          <InteractionFormModal
            contactName={contact.name}
            onClose={() => setAdding(false)}
            onSaved={async (text) => {
              setAdding(false);
              setMsg({ ok: true, text });
              await load();
            }}
          />
        )}
      </div>
    </main>
  );
}

/** 快速补一笔往来（不涉及金额；金额请用财务页记一笔并填「对方」） */
function InteractionFormModal({
  contactName,
  onClose,
  onSaved,
}: {
  contactName: string;
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const { id } = useParams<{ id: string }>();
  const [type, setType] = useState<InteractionType>("见面");
  const [summary, setSummary] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl sm:max-w-md sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">补一笔往来 · {contactName}</h3>
          <button onClick={onClose} className="rounded px-2 text-slate-500 hover:text-slate-200">✕</button>
        </div>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as InteractionType)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
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
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
            />
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="记点什么（如：一起看了场电影）"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          />
          {err && <p className="text-xs text-rose-300">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-xs text-slate-400 hover:bg-slate-700">
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
