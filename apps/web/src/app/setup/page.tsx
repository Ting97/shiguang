"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/shared/api";

export default function SetupPage() {
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // 已有账号或已登录 → 回登录/首页（未登录 401 → 停留本页继续初始化）
    api("/api/auth/me")
      .then(() => {
        location.href = "/";
      })
      .catch(() => {});
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
      // 部署配置了 SETUP_TOKEN 时服务端强制校验 x-setup-token 头（一次性）；
      // 旧实现从不携带该头——令牌模式的部署首次提交即 403 且令牌作废，初始化走不通
      await api(
        "/api/auth/setup",
        "POST",
        { nickname, phone, password },
        setupToken.trim() ? { "x-setup-token": setupToken.trim() } : undefined,
      );
      location.href = "/";
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403 && e.message.includes("管理员已存在")) {
        setMsg({ ok: false, text: "管理员已存在，即将跳转登录页…" });
        setTimeout(() => (location.href = "/login"), 1200);
        return;
      }
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "input-glow w-full rounded-xl border border-line-soft bg-surface/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint";

  return (
    <main className="flex min-h-screen items-center justify-center px-5 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-gradient text-3xl font-bold">拾光</h1>
          <p className="mt-1 text-xs text-ink-dim">首次使用 · 创建管理员账号</p>
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
            <input
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="初始化令牌（部署配置了 SETUP_TOKEN 时必填）"
              className={inputCls}
            />
            <button onClick={submit} disabled={busy} className="btn-primary w-full rounded-xl py-2.5 text-sm font-medium">
              {busy ? "创建中…" : "创建管理员并进入"}
            </button>
          </div>
          {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            管理员将接管本站全部既有记录；此后其他账号凭管理员生成的邀请码注册，数据互相隔离。
          </p>
        </div>
      </div>
    </main>
  );
}
