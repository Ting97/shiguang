"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/nav";

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
    "input-glow w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600";

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <h1 className="text-gradient mb-1 text-2xl font-bold">个人设置</h1>
        <p className="mb-5 text-xs text-slate-500">个性化你的账号信息</p>

        {!me ? (
          <p className="py-10 text-center text-xs text-slate-500">加载中…</p>
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
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    {me.phone ? (
                      <>
                        {me.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            me.phoneVerified ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {me.phoneVerified ? "已验证" : "未验证"}
                        </span>
                      </>
                    ) : (
                      "未绑定手机号"
                    )}
                    {me.isAdmin && (
                      <span className="rounded bg-gradient-to-r from-sky-500/20 to-indigo-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                        管理员
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">加入于 {zhDate(me.createdAt)}</p>
                </div>
              </div>

              <label className="mb-1 block text-xs text-slate-400">昵称</label>
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
              {msgNick && <p className={`mt-2 text-xs ${msgNick.ok ? "text-emerald-300" : "text-rose-300"}`}>{msgNick.text}</p>}
            </section>

            {/* 修改密码 */}
            <section className="glass rounded-2xl p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">修改密码</h2>
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
              {msgPwd && <p className={`mt-3 text-xs ${msgPwd.ok ? "text-emerald-300" : "text-rose-300"}`}>{msgPwd.text}</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
