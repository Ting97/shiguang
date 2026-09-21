"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/nav";
import { TagChip } from "@/components/tag-chip";

interface Me {
  id: string;
  nickname: string | null;
  phone: string | null;
  isAdmin: boolean;
  authDisabled: boolean;
  phoneVerified: boolean;
  createdAt: string | null;
}

const zhDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [nickname, setNickname] = useState("");
  const [savedNick, setSavedNick] = useState<string | null>(null);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [msgNick, setMsgNick] = useState<{ ok: boolean; text: string } | null>(null);
  const [msgPwd, setMsgPwd] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<{
    plan: string;
    used: number;
    limit: number | null;
    planExpiresAt: string | null;
    isAdmin: boolean;
    byModel?: { model: string; all: { calls: number; promptTokens: number; completionTokens: number }; d30: { calls: number } }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.status === 401) {
        location.href = "/login";
        return;
      }
      const j: Me = await r.json();
      setMe(j);
      setNickname(j.nickname ?? "");
      setSavedNick(j.nickname ?? "");
    });
    // 套餐与 AI 用量（30 天窗口）
    fetch("/api/billing/plan").then(async (r) => {
      if (!r.ok) return;
      setQuota(await r.json());
    });
  }, []);

  async function saveNickname() {
    if (busy) return;
    setMsgNick(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失败");
      setMsgNick({ ok: true, text: "✅ 昵称已更新（导航栏即刻生效）" });
      setSavedNick(j.nickname);
      setTimeout(() => location.reload(), 800); // 让 Nav 重新拉取
    } catch (e) {
      setMsgNick({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (busy) return;
    setMsgPwd(null);
    if (newPwd !== confirmPwd) {
      setMsgPwd({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPwd || undefined, newPassword: newPwd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失败");
      setMsgPwd({ ok: true, text: "✅ 密码已更新，下次登录请使用新密码" });
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      setMsgPwd({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "input-glow w-full rounded-xl border border-line-soft bg-surface/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint";

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <h1 className="text-gradient mb-1 text-center text-3xl font-bold sm:text-4xl">我的<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">个人设置</span></h1>
        <p className="mb-5 text-xs text-ink-dim">个性化你的账号信息</p>

        {!me ? (
          <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
        ) : (
          <>
            {/* 账号资料 */}
            <section className="glass mb-5 rounded-2xl p-5">
              <div className="mb-4 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-xl font-bold text-white shadow-lg shadow-sky-500/30">
                  {(savedNick || "我").slice(0, 1).toUpperCase()}
                </div>
                <div className="text-sm">
                  <p className="font-medium">{savedNick || "未设置昵称"}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-dim">
                    {me.phone ? (
                      <>
                        {me.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            me.phoneVerified ? "bg-emerald-500/10 text-success" : "bg-elevated text-ink-mute"
                          }`}
                        >
                          {me.phoneVerified ? "已验证" : "未验证"}
                        </span>
                      </>
                    ) : (
                      "未绑定手机号"
                    )}
                    {me.isAdmin && (
                      <span className="rounded bg-gradient-to-r from-sky-500/20 to-indigo-500/20 px-1.5 py-0.5 text-[10px] text-accent">
                        管理员
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">加入于 {zhDate(me.createdAt)}</p>
                </div>
              </div>

              <label className="mb-1 block text-xs text-ink-mute">昵称</label>
              <div className="flex gap-2">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  placeholder="给自己起个名字"
                  className={`${inputCls} flex-1`}
                />
                <button
                  onClick={saveNickname}
                  disabled={busy || nickname.trim() === savedNick}
                  className="btn-primary shrink-0 rounded-xl px-5 text-sm font-medium"
                >
                  保存
                </button>
              </div>
              {msgNick && <p className={`mt-2 text-xs ${msgNick.ok ? "text-success" : "text-danger"}`}>{msgNick.text}</p>}
            </section>

            {/* 修改密码 */}
            <section className="glass rounded-2xl p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink-soft">修改密码</h2>
              <div className="space-y-3">
                <input
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  type="password"
                  placeholder="当前密码（从未设过密码可留空）"
                  className={inputCls}
                />
                <input
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  type="password"
                  placeholder="新密码（至少 8 位）"
                  className={inputCls}
                />
                <input
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  type="password"
                  placeholder="确认新密码"
                  className={inputCls}
                />
                <button
                  onClick={savePassword}
                  disabled={busy || !newPwd}
                  className="btn-primary w-full rounded-xl py-2.5 text-sm font-medium"
                >
                  更新密码
                </button>
              </div>
              {msgPwd && <p className={`mt-3 text-xs ${msgPwd.ok ? "text-success" : "text-danger"}`}>{msgPwd.text}</p>}
            </section>

            {/* 套餐与 AI 用量（M3 商业化） */}
            <section className="glass rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-ink-soft"><TagChip icon="💎" label="套餐与 AI 用量" tone="violet" /></h2>
              {quota ? (
                <>
                  <p className="mt-1 text-xs text-ink-dim">
                    当前套餐：
                    <span className={quota.plan === "pro" ? "font-semibold text-amber-400" : "font-semibold text-ink"}>
                      {quota.plan === "pro" ? "Pro" : "免费版"}
                    </span>
                    {quota.planExpiresAt && ` · Pro 有效期至 ${new Date(quota.planExpiresAt).toLocaleDateString("zh-CN")}`}
                    {quota.isAdmin && " · 管理员不限量"}
                  </p>
                  <div className="mt-2.5">
                    <div className="flex justify-between text-xs text-ink-dim">
                      <span>近 30 天 AI 识别次数</span>
                      <span>{quota.used}{quota.limit === null ? "（不限）" : ` / ${quota.limit}`}</span>
                    </div>
                    {quota.limit !== null && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
                        <div
                          className={`h-full rounded-full ${quota.used >= quota.limit ? "bg-rose-500" : "bg-sky-500"}`}
                          style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {quota.byModel && quota.byModel.length > 0 && (
                    <ul className="mt-2.5 space-y-0.5">
                      {quota.byModel.map((m) => (
                        <li key={m.model} className="flex items-center gap-2 text-[11px] tabular-nums text-ink-mute">
                          <span className="font-medium text-ink-soft">{m.model || "其他模型"}</span>
                          <span className="ml-auto">
                            近30天 {m.d30.calls} 次 · 累计 {m.all.calls} 次 /{" "}
                            {(m.all.promptTokens + m.all.completionTokens).toLocaleString("zh-CN")} tokens
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] text-ink-faint">语音速记、AI 识别、复盘均消耗次数；Pro 不限量。支付通道接入前，内测期间联系管理员开通 Pro。</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-ink-dim">加载中…</p>
              )}
              {/* 管理员：后台入口（管理功能集中在 /admin） */}
              {quota?.isAdmin && (
                <a
                  href="/admin"
                  className="mt-4 flex items-center gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 transition hover:bg-sky-500/20"
                >
                  <span className="text-lg">🛠</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-accent">后台管理</span>
                    <span className="block text-[11px] text-ink-dim">AI prompt 调优 · 邀请与套餐 · Token 消耗</span>
                  </span>
                  <span className="text-ink-mute">→</span>
                </a>
              )}
            </section>

            {/* 数据导出（docs/06 P8）：个人数据可携带 */}
            <section className="glass rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-ink-soft"><TagChip icon="📦" label="导出我的数据" tone="slate" /></h2>
              <p className="mt-1 text-xs text-ink-dim">全量备份包含动态、日程、待办、流水、联系人与往来；Markdown 版可读性更好。建议定期下载备份。</p>
              <div className="mt-3 flex gap-2">
                <a
                  href="/api/export?format=json"
                  className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-medium text-accent transition hover:bg-sky-500/20"
                >
                  全量备份 (JSON)
                </a>
                <a
                  href="/api/export?format=md"
                  className="rounded-xl border border-line-soft bg-surface/60 px-4 py-2 text-xs text-ink-soft transition hover:border-sky-500/50"
                >
                  动态日记 (Markdown)
                </a>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
