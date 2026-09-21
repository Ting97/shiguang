"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 邀请管理面板（仅管理员）：嵌入个人设置页。
 * 含 Token 消耗（自己 + 被邀请人）、邀请码生成与列表。
 */

interface Invite {
  code: string;
  used_by: string | null;
  used_by_name: string | null;
  expires_at: string | null;
  created_at: string;
}

interface Usage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

interface UsageSelf {
  all: Usage;
  d30: Usage;
}

interface UsageInvitee {
  id: string;
  nickname: string;
  phoneTail: string | null;
  createdAt: string;
  all: Usage;
  d30: Usage;
}

interface UsageByModel {
  model: string;
  all: Usage;
  d30: Usage;
}

const zhDate = (iso: string | null) => {
  if (!iso) return "不限";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const fmtTokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("zh-CN"));
const fmtTotal = (u: Usage) => fmtTokens(u.promptTokens + u.completionTokens);

export default function InvitesPanel() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ self: UsageSelf; invitees: UsageInvitee[]; byModel?: UsageByModel[] } | null>(null);

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
    fetch("/api/tokens/usage")
      .then((r2) => (r2.ok ? r2.json() : null))
      .then((j2) => setUsage(j2 ? { self: j2.self, invitees: j2.invitees ?? [], byModel: j2.byModel ?? [] } : null))
      .catch(() => {});
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
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // 剪贴板权限受限（窗口失焦/非安全上下文）→ 降级 execCommand；仍失败则提示手动复制
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) {
        setMsg("❌ 复制失败，请手动选中邀请码复制");
        return;
      }
    }
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  const statusOf = (i: Invite) => {
    if (i.used_by) return { text: `已使用 · ${i.used_by_name ?? ""}`, cls: "text-ink-dim bg-elevated" };
    if (i.expires_at && new Date(i.expires_at) < new Date())
      return { text: "已过期", cls: "text-danger bg-rose-500/10" };
    return { text: "未使用", cls: "text-success bg-emerald-500/10" };
  };

  if (state === "loading") {
    return (
      <section className="glass mb-5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">📣 邀请管理</h2>
        <p className="mt-2 py-4 text-center text-xs text-ink-dim">加载中…</p>
      </section>
    );
  }
  if (state === "forbidden") {
    return (
      <section className="glass mb-5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">📣 邀请管理</h2>
        <p className="mt-2 text-xs text-ink-mute">仅管理员（初始化账号）可管理邀请码</p>
      </section>
    );
  }

  return (
    <section className="glass mb-5 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-ink-soft">📣 邀请管理</h2>
      <p className="mt-1 text-xs text-ink-dim">
        新用户凭邀请码注册（一码一人）；生成后把码发给对方，对方在登录页点「凭邀请码注册」
      </p>

      {/* Token 消耗（管理员视角：自己 + 被邀请人） */}
      <div className="mt-4 border-t border-line-soft pt-3">
        <p className="text-xs font-medium text-ink-soft">
          📊 Token 消耗
          <span className="ml-1.5 text-[11px] font-normal text-ink-dim">识别 · 复盘 · 语音全阶段</span>
        </p>

        {!usage ? (
          <p className="mt-2 text-xs text-ink-dim">消耗数据加载中…</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["全部累计", usage.self.all],
                  ["近 30 天", usage.self.d30],
                ] as const
              ).map(([label, u]) => (
                <div key={label} className="rounded-xl border border-line-soft bg-elevated/60 px-3 py-2.5">
                  <p className="text-[11px] text-ink-dim">
                    我的消耗 · {label}
                    <span className="ml-1 text-ink-faint">（{u.calls} 次调用）</span>
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                    {fmtTotal(u)} <span className="text-xs font-normal text-ink-mute">tokens</span>
                  </p>
                  <p className="text-[10px] tabular-nums text-ink-faint">
                    输入 {fmtTokens(u.promptTokens)} · 输出 {fmtTokens(u.completionTokens)}
                  </p>
                </div>
              ))}
            </div>

            {/* 按模型统计 */}
            {usage.byModel && usage.byModel.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] text-ink-dim">按模型统计（自己 + 被邀请人）</p>
                <div className="overflow-hidden rounded-xl border border-line-soft">
                  <table className="w-full text-left text-[11px] tabular-nums">
                    <thead className="bg-elevated/60 text-ink-dim">
                      <tr>
                        <th className="px-2.5 py-1.5 font-medium">模型</th>
                        <th className="px-2 py-1.5 font-medium">全部调用</th>
                        <th className="px-2 py-1.5 font-medium">全部 tokens</th>
                        <th className="px-2 py-1.5 font-medium">30 天调用</th>
                        <th className="px-2 py-1.5 font-medium">30 天 tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byModel.map((m) => (
                        <tr key={m.model} className="border-t border-line-soft">
                          <td className="px-2.5 py-1.5 font-medium text-ink">{m.model}</td>
                          <td className="px-2 py-1.5 text-ink-mute">{m.all.calls}</td>
                          <td className="px-2 py-1.5 text-ink">{fmtTotal(m.all)}</td>
                          <td className="px-2 py-1.5 text-ink-mute">{m.d30.calls}</td>
                          <td className="px-2 py-1.5 text-ink">{fmtTotal(m.d30)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-ink-faint">
                  tokens = 输入 + 输出；明细可按 stage（asr/parse/review/chat）在 audit_logs 表中进一步追溯
                </p>
              </div>
            )}

            {/* 被邀请人消耗 */}
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] text-ink-dim">被邀请人（{usage.invitees.length} 人）</p>
              {usage.invitees.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[11px] text-ink-dim">
                  还没有通过邀请码注册的用户
                </p>
              ) : (
                <ul className="space-y-1">
                  {usage.invitees.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-xs hover:bg-wash">
                      <span className="font-medium text-ink">
                        {p.nickname}
                        {p.phoneTail && <span className="ml-1 text-[10px] font-normal text-ink-faint">尾号 {p.phoneTail}</span>}
                      </span>
                      <span className="text-[10px] text-ink-faint">{zhDate(p.createdAt)} 加入</span>
                      <span className="ml-auto tabular-nums text-ink-mute">
                        近 30 天 <span className="tabular-nums text-ink">{fmtTotal(p.d30)}</span> · 累计{" "}
                        <span className="tabular-nums text-ink">{fmtTotal(p.all)}</span>
                        <span className="ml-1 text-[10px] text-ink-faint">tokens（{p.all.calls} 次）</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* 生成区 */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
        <label className="flex items-center gap-2 text-xs text-ink-mute">
          有效期
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border border-line-soft bg-surface px-2 py-1.5 text-xs outline-none focus:border-sky-500"
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
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>

      {/* 列表 */}
      <div className="mt-3 border-t border-line-soft pt-3">
        {invites.length === 0 ? (
          <p className="empty-state">还没有邀请码 —— 点上方「生成邀请码」创建第一个</p>
        ) : (
          <ul className="space-y-1.5">
            {invites.map((i) => {
              const st = statusOf(i);
              const usable = !i.used_by && !(i.expires_at && new Date(i.expires_at) < new Date());
              return (
                <li key={i.code} className="glass glass-hover flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="flex-1 font-mono text-base tracking-[0.2em] text-ink">{i.code}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${st.cls}`}>{st.text}</span>
                  <span className="hidden shrink-0 text-[10px] text-ink-faint sm:inline">
                    {zhDate(i.created_at)} 生成 · 有效至 {zhDate(i.expires_at)}
                  </span>
                  {usable && (
                    <button
                      onClick={() => copy(i.code)}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] text-accent transition hover:bg-wash"
                    >
                      {copied === i.code ? "✓ 已复制" : "复制"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
