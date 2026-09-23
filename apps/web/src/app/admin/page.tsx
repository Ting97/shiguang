"use client";

import { useEffect, useState } from "react";
import AdminAiPanel from "@/components/admin-ai-panel";
import AdminMarketingPanel from "@/components/admin-marketing-panel";
import { FilterChip, TagChip } from "@/components/tag-chip";

/**
 * /admin 后台（REQ-001 R4）：仅管理员。AI 管理（prompt 在线调优 + AI 协助优化）+ 营销管理。
 * 门禁：静态导出页面无服务端鉴权——前端 403 态 + /api/admin/* 层 role 硬校验（安全边界）。
 */

type Tab = "ai" | "marketing";

export default function AdminPage() {
  const [me, setMe] = useState<{ nickname: string | null; isAdmin: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("ai");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.status === 401) {
        location.href = "/login";
        return;
      }
      setMe(await r.json());
    });
  }, []);

  const notify = (text: string, ok = true) => {
    setMsg({ ok, text });
    if (ok) setTimeout(() => setMsg(null), 3500);
  };

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">

        {me && !me.isAdmin ? (
          <div className="glass mt-10 rounded-2xl p-10 text-center">
            <p className="text-4xl">🔒</p>
            <h1 className="mt-3 text-lg font-bold">需要管理员权限</h1>
            <p className="mt-1 text-xs text-ink-dim">此页面仅超级管理员可见</p>
            <a href="/" className="btn-primary mt-5 inline-block rounded-xl px-5 py-2 text-sm font-medium">
              返回首页
            </a>
          </div>
        ) : (
          <>
            {/* 模块头 */}
            <div className="glass mb-5 flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-gradient text-xl font-bold tracking-wide">
                后台管理
                <span className="ml-2 align-middle text-xs font-normal tracking-normal text-ink-dim">
                  AI prompt 在线调优 · 营销集中
                </span>
              </h1>
              <div className="flex rounded-full border border-line-soft bg-bg/50 p-0.5 text-xs sm:w-auto">
                <FilterChip variant="pill" active={tab === "ai"} onClick={() => setTab("ai")} label="🤖 AI 管理" />
                <FilterChip variant="pill" active={tab === "marketing"} onClick={() => setTab("marketing")} label="📣 营销管理" />
              </div>
            </div>

            {msg && (
              <div
                className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                  msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"
                }`}
              >
                {msg.text}
              </div>
            )}

            {!me ? (
              <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
            ) : tab === "ai" ? (
              <section className="glass rounded-2xl p-5">
                <p className="mb-4 flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <TagChip icon="💡" label="保存即生效" tone="amber" size="sm" />
                  改坏可回滚版本历史或秒切代码默认；AI 优化只出建议稿，采纳后仍需手动保存
                </p>
                <AdminAiPanel notify={notify} />
              </section>
            ) : (
              <AdminMarketingPanel notify={notify} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
