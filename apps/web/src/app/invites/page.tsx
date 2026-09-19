"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/nav";

interface Invite {
  code: string;
  used_by: string | null;
  used_by_name: string | null;
  expires_at: string | null;
  created_at: string;
}

const zhDate = (iso: string | null) => {
  if (!iso) return "不限";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/auth/invites");
    if (r.status === 401) {
      location.href = "/login";
      return;
    }
    if (r.status === 403) {
      setState("forbidden");
      return;
    }
    const j = await r.json();
    setInvites(j.invites ?? []);
    setState("ok");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/auth/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setMsg(`✅ 已生成邀请码 ${j.invite.code}`);
      await load();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  const statusOf = (i: Invite) => {
    if (i.used_by) return { text: `已使用 · ${i.used_by_name ?? ""}`, cls: "text-slate-500 bg-slate-800" };
    if (i.expires_at && new Date(i.expires_at) < new Date())
      return { text: "已过期", cls: "text-rose-300 bg-rose-500/10" };
    return { text: "未使用", cls: "text-emerald-300 bg-emerald-500/10" };
  };

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <h1 className="text-gradient mb-1 text-center text-3xl font-bold sm:text-4xl">邀请<span className="ml-2 align-middle text-sm font-normal tracking-normal text-slate-500">邀请码管理</span></h1>
        <p className="mb-5 text-xs text-slate-500">
          新用户凭邀请码注册（一码一人）；生成后把码发给对方，对方在登录页点「凭邀请码注册」
        </p>

        {state === "loading" && <p className="py-10 text-center text-xs text-slate-500">加载中…</p>}
        {state === "forbidden" && (
          <p className="glass rounded-2xl py-10 text-center text-xs text-slate-400">
            仅管理员（初始化账号）可管理邀请码
          </p>
        )}

        {state === "ok" && (
          <>
            {/* 生成区 */}
            <div className="glass mb-5 flex flex-wrap items-center gap-3 rounded-2xl p-4">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                有效期
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                >
                  <option value={7}>7 天</option>
                  <option value={30}>30 天</option>
                  <option value={90}>90 天</option>
                  <option value={0}>不限</option>
                </select>
              </label>
              <button onClick={generate} disabled={busy} className="btn-primary rounded-xl px-5 py-1.5 text-sm font-medium">
                {busy ? "生成中…" : "生成邀请码"}
              </button>
              {msg && <span className="text-xs text-slate-300">{msg}</span>}
            </div>

            {/* 列表 */}
            {invites.length === 0 ? (
              <p className="empty-state">
                还没有邀请码 —— 点上方「生成邀请码」创建第一个
              </p>
            ) : (
              <ul className="space-y-1.5">
                {invites.map((i) => {
                  const st = statusOf(i);
                  const usable = !i.used_by && !(i.expires_at && new Date(i.expires_at) < new Date());
                  return (
                    <li key={i.code} className="glass glass-hover flex items-center gap-3 rounded-xl px-3 py-2.5">
                      <span className="flex-1 font-mono text-base tracking-[0.2em] text-slate-100">{i.code}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${st.cls}`}>{st.text}</span>
                      <span className="hidden shrink-0 text-[10px] text-slate-600 sm:inline">
                        {zhDate(i.created_at)} 生成 · 有效至 {zhDate(i.expires_at)}
                      </span>
                      {usable && (
                        <button
                          onClick={() => copy(i.code)}
                          className="shrink-0 rounded px-2 py-0.5 text-[11px] text-sky-300 transition hover:bg-white/5"
                        >
                          {copied === i.code ? "✓ 已复制" : "复制"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
