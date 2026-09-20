"use client";

import { useEffect, useRef, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "sms">("password"); // 登录方式：密码/验证码
  const [isRegister, setIsRegister] = useState(false);
  const [account, setAccount] = useState(""); // 手机号或邮箱（含 @ 自动识别）
  const [password, setPassword] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [invite, setInvite] = useState("");
  const [nickname, setNickname] = useState(""); // 注册必填
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 已登录直接回首页
    fetch("/api/auth/me").then((r) => {
      if (r.ok) location.href = "/";
    });
  }, []);

  useEffect(() => {
    if (countdown <= 0 && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [countdown]);

  function startCountdown() {
    setCountdown(60);
    timer.current = setInterval(() => setCountdown((c) => c - 1), 1000);
  }

  async function sendCode() {
    const isEmail = account.includes("@");
    if (isEmail ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(account) : !/^1[3-9]\d{9}$/.test(account)) {
      setMsg({ ok: false, text: isEmail ? "请先填写正确的邮箱地址" : "请先填写正确的手机号" });
      return;
    }
    const r = await fetch(isEmail ? "/api/auth/email/send" : "/api/auth/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isEmail ? { email: account, purpose: "login" } : { phone: account, purpose: "login" }),
    });
    const j = await r.json();
    if (r.ok) {
      setMsg({ ok: true, text: "验证码已发送，5 分钟内有效" });
      startCountdown();
    } else {
      setMsg({ ok: false, text: j.error ?? "发送失败" });
      // 通道未开通：注册场景下邀请码即凭证，可不填验证码
      if (isRegister && r.status === 503) {
        setMsg({ ok: false, text: `${j.error}（当前注册凭邀请码即可，验证码可留空）` });
      }
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let r: Response;
      if (isRegister) {
        r = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            account.includes("@")
              ? { email: account, password, emailCode: smsCode || undefined, inviteCode: invite, nickname: nickname.trim() || undefined }
              : { phone: account, password, smsCode: smsCode || undefined, inviteCode: invite, nickname: nickname.trim() || undefined },
          ),
        });
      } else if (mode === "password") {
        r = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            account.includes("@") ? { email: account, password } : { phone: account, password },
          ),
        });
      } else {
        r = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            account.includes("@") ? { email: account, emailCode: smsCode } : { phone: account, smsCode },
          ),
        });
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      location.href = "/";
    } catch (e) {
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
          <h1 className="text-gradient text-3xl font-bold">拾光复利</h1>
          <p className="mt-1 text-xs text-ink-dim">拾起光阴，记录今日 · {isRegister ? "凭邀请码注册" : "登录后继续"}</p>
        </div>

        <div className="glass rounded-2xl p-5">
          {/* 登录方式切换（仅登录态） */}
          {!isRegister && (
            <div className="mb-4 flex rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs">
              <button
                onClick={() => setMode("password")}
                className={`flex-1 rounded-full px-3 py-1.5 transition-all ${
                  mode === "password"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                密码登录
              </button>
              <button
                onClick={() => setMode("sms")}
                className={`flex-1 rounded-full px-3 py-1.5 transition-all ${
                  mode === "sms"
                    ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                验证码登录
              </button>
            </div>
          )}

          <div className="space-y-3">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value.trim())}
              placeholder="手机号 / 邮箱"
              className={inputCls}
            />

            {isRegister || mode === "sms" ? (
              <div className="flex gap-2">
                <input
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                  placeholder={isRegister ? "邮箱/短信验证码（未开通可留空）" : "6 位验证码"}
                  className={`${inputCls} flex-1`}
                />
                <button
                  onClick={sendCode}
                  disabled={countdown > 0}
                  className="shrink-0 rounded-xl border border-line-soft bg-elevated/70 px-3 text-xs text-accent transition hover:border-sky-500/50 disabled:opacity-40"
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </button>
              </div>
            ) : (
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="密码"
                className={inputCls}
              />
            )}

            {isRegister && (
              <>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  placeholder="昵称（必填）"
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
                  value={invite}
                  onChange={(e) => setInvite(e.target.value.toUpperCase())}
                  placeholder="邀请码"
                  className={`${inputCls} uppercase`}
                />
              </>
            )}

            <button onClick={submit} disabled={busy} className="btn-primary w-full rounded-xl py-2.5 text-sm font-medium">
              {busy ? "处理中…" : isRegister ? "注册并登录" : "登录"}
            </button>
          </div>

          {msg && (
            <p className={`mt-3 text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
          )}

          <p className="mt-4 text-center text-[11px] text-ink-dim">
            {isRegister ? "已有账号？" : "没有账号？"}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setMsg(null);
              }}
              className="ml-1 text-accent hover:underline"
            >
              {isRegister ? "去登录" : "凭邀请码注册"}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-[10px] text-ink-faint">个人经营系统 · 钱 · 时间 · 人</p>
      </div>
    </main>
  );
}
