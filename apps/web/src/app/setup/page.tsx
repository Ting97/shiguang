"use client";

import { useEffect, useState } from "react";

export default function SetupPage() {
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // 已有账号或已登录 → 回登录/首页
    fetch("/api/auth/me").then((r) => {
      if (r.ok) location.href = "/";
    });
  }, []);

  async function submit() {
    if (busy) return;
    if (password !== confirm) {
      setMsg({ ok: false, text: "两次输入的密码不一致" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, phone, password }),
      });
      const j = await r.json();
      if (r.status === 403) {
        setMsg({ ok: false, text: "管理员已存在，即将跳转登录页…" });
        setTimeout(() => (location.href = "/login"), 1200);
        return;
      }
      if (!r.ok) throw new Error(j.error ?? "初始化失败");
      location.href = "/";
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "input-glow w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600";

  return (
    <main className="flex min-h-screen items-center justify-center px-5 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-gradient text-3xl font-bold">拾光复利</h1>
          <p className="mt-1 text-xs text-slate-500">首次使用 · 创建管理员账号</p>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="space-y-3">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="昵称"
              className={inputCls}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={11}
              inputMode="numeric"
              placeholder="手机号"
              className={inputCls}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="设置密码（至少 8 位）"
              className={inputCls}
            />
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              placeholder="确认密码"
              className={inputCls}
            />
            <button onClick={submit} disabled={busy} className="btn-primary w-full rounded-xl py-2.5 text-sm font-medium">
              {busy ? "创建中…" : "创建管理员并进入"}
            </button>
          </div>
          {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
            管理员将接管本站全部既有记录；此后其他账号凭管理员生成的邀请码注册，数据互相隔离。
          </p>
        </div>
      </div>
    </main>
  );
}
