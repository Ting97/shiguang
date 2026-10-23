"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiClientError } from "@/shared/api";
import { toast } from "@/shared/ui/toast";

export default function SetupPage() {
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);

  // 403「管理员已存在」后的延迟跳转句柄：卸载时清除（等待期手动导航他页不被强拉回 /login）
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (redirectTimer.current) clearTimeout(redirectTimer.current); }, []);

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
    if (!nickname.trim() || !phone.trim()) {
      // 账号信息必填：空值直接提交会被服务端 422 拒绝，这里先行拦截给出可读提示
      toast("请先填写昵称与手机号", "err");
      return;
    }
    if (password.length < 8) {
      toast("密码至少 8 位", "err"); // 前端先拦（二十轮）：服务端 422 兜底但往返慢
      return;
    }
    if (password !== confirm) {
      toast("两次输入的密码不一致", "err");
      return;
    }
    setBusy(true);
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
          toast("管理员已存在，即将跳转登录页…", "err");
          // 登记到 ref 并在卸载时清除：跳转等待期手动导航他页会被强拉回 /login
          redirectTimer.current = setTimeout(() => (location.href = "/login"), 1200);
          return;
        }
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "input-glow w-full rounded-xl border border-line-soft bg-surface/60 px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint";

  // 表单无 form 包裹的裸输入行：Enter 直接提交（与登录页同口径，走 submit 的校验与 busy 门）；
  // 中文输入法组词中的 Enter（isComposing）不触发
  const onEnterSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
  };

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
              onKeyDown={onEnterSubmit}
              placeholder="昵称"
              className={inputCls}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={onEnterSubmit}
              maxLength={11}
              inputMode="numeric"
              placeholder="手机号"
              className={inputCls}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnterSubmit}
              type="password"
              placeholder="设置密码（至少 8 位）"
              className={inputCls}
            />
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnterSubmit}
              type="password"
              placeholder="确认密码"
              className={inputCls}
            />
            <input
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              onKeyDown={onEnterSubmit}
              placeholder="初始化令牌（部署配置了 SETUP_TOKEN 时必填）"
              className={inputCls}
            />
            <button onClick={submit} disabled={busy} className="btn-primary w-full rounded-xl py-2.5 text-sm font-medium">
              {busy ? "创建中…" : "创建管理员并进入"}
            </button>
          </div>
          <p className="mt-4 text-micro leading-relaxed text-ink-faint">
            管理员将接管本站全部既有记录；此后其他账号凭管理员生成的邀请码注册，数据互相隔离。
          </p>
        </div>
      </div>
    </main>
  );
}
