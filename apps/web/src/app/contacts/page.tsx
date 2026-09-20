"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Nav from "@/components/nav";
import Skeleton from "@/components/skeleton";
import ContactFormModal from "@/components/contact-form";
import ContactGraph from "@/components/contact-graph";
import { api } from "@/lib/client-api";
import { CONTACT_GROUPS, GROUP_EMOJI, birthdayLabel, displaySummary } from "@/lib/social";

interface Contact {
  id: string;
  name: string;
  alias: string | null;
  group_tag: string;
  birthday: string | null;
  birthday_cal: string | null;
  lunar_month: number | null;
  lunar_day: number | null;
  lunar_leap: boolean | null;
  anniversary: string | null;
  intimacy: number;
  importance: number;
  notes: string | null;
  created_at: string;
  interaction_count: number;
  last_at: string | null;
  last_summary: string | null;
  gift_net_cents: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 相对时间：刚刚/N分钟前/N小时前/昨天/M月D日 */
function relTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / 86_400_000);
  if (days === 1) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [groups, setGroups] = useState<Set<string>>(new Set()); // 多选；空集=全部分组
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "graph">("list");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

  const load = useCallback(async () => {
    const j = await api("/api/contacts", "GET");
    setContacts(j.contacts ?? []);
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [load]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const groupChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of contacts ?? []) counts.set(c.group_tag, (counts.get(c.group_tag) ?? 0) + 1);
    return ["全部", ...CONTACT_GROUPS.filter((g) => counts.get(g))].map((g) => ({
      name: g,
      count: g === "全部" ? (contacts?.length ?? 0) : (counts.get(g) ?? 0),
    }));
  }, [contacts]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (contacts ?? []).filter(
      (c) =>
        (groups.size === 0 || groups.has(c.group_tag)) &&
        (!kw ||
          c.name.toLowerCase().includes(kw) ||
          (c.alias ?? "").toLowerCase().includes(kw) ||
          (c.notes ?? "").toLowerCase().includes(kw)),
    );
  }, [contacts, groups, q]);

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <header className="mb-6 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">人际</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">
            动态里提到的人都在这里 —— 分组档案、生日提醒、往来时间线
          </p>
          {/* 列表 | 图谱 视图切换 */}
          <div className="mt-4 inline-flex rounded-full border border-line-soft bg-surface/70 p-1 text-xs">
            {([
              ["list", "📋 列表"],
              ["graph", "🕸 图谱"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-4 py-1.5 transition-all duration-200 ${
                  view === v
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* 分组筛选 + 搜索 + 建档 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {groupChips.map((g) => {
              const isAll = g.name === "全部";
              const selected = isAll ? groups.size === 0 : groups.has(g.name);
              return (
                <button
                  key={g.name}
                  onClick={() => {
                    if (isAll) {
                      setGroups(new Set());
                      return;
                    }
                    setGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.name)) next.delete(g.name);
                      else next.add(g.name);
                      return next;
                    });
                  }}
                  title={isAll ? "显示全部分组" : "点击加入/移出筛选（可多选）"}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs transition ${
                    selected
                      ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                      : "border border-line-soft bg-surface/60 text-ink-mute hover:bg-wash hover:text-ink"
                  }`}
                >
                  {g.name === "全部" ? "全部" : `${GROUP_EMOJI[g.name] ?? "👤"} ${g.name}`} {g.count}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索姓名/备注…"
              className="w-36 rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
            />
            <button onClick={() => setEditing("new")} className="btn-primary whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium">
              ＋ 建档
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
              msg.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-success"
                : "border-rose-500/30 bg-rose-500/10 text-danger"
            }`}
          >
            {msg.text}
          </div>
        )}

        {contacts === null ? (
          <Skeleton rows={4} className="py-2" />
        ) : contacts.length === 0 ? (
          <p className="empty-state py-10">
            还没有联系人 —— 动态里说「和老王吃饭」，TA 会自动出现在这里
          </p>
        ) : filtered.length === 0 ? (
          <p className="empty-state py-10">
            没有匹配的联系人
          </p>
        ) : view === "graph" ? (
          <ContactGraph contacts={filtered} onOpen={(id) => router.push(`/contacts/${id}`)} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((c) => {
              const bd = birthdayLabel(c);
              return (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="glass glass-hover group block rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-gradient-to-br from-elevated to-surface text-xl">
                      {GROUP_EMOJI[c.group_tag] ?? "👤"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <span className="truncate">{c.name}</span>
                        {c.alias && <span className="truncate text-xs font-normal text-ink-dim">（{c.alias}）</span>}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-dim">
                        <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-ink-mute">{c.group_tag}</span>
                        {bd?.countdown && <span className="text-ai">{bd.countdown}</span>}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-dim">{c.interaction_count} 次</span>
                  </div>
                  <p className="mt-2.5 truncate text-xs text-ink-mute">
                    {c.last_at ? (
                      <>
                        <span className="text-ink-dim">{relTime(c.last_at)}</span> · {displaySummary(c.last_summary) || "往来"}
                      </>
                    ) : (
                      <span className="text-ink-faint">暂无往来记录</span>
                    )}
                  </p>
                  {Number(c.gift_net_cents) !== 0 && (
                    <p className="mt-1 text-[11px] tabular-nums text-ink-dim">
                      人情往来 {Number(c.gift_net_cents) > 0 ? "+" : ""}
                      {`¥${(Math.abs(Number(c.gift_net_cents)) / 100).toFixed(Math.abs(Number(c.gift_net_cents)) % 100 === 0 ? 0 : 2)}`}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {editing && (
          <ContactFormModal
            initial={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={async (text) => {
              setEditing(null);
              setMsg({ ok: true, text });
              await load();
            }}
          />
        )}

        <footer className="mt-10 text-center text-[10px] text-ink-faint">
          拾光 · 人际模块 v2（Phase 3 W9~W11）· 语音提及自动建档
        </footer>
      </div>
    </main>
  );
}
