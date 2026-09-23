"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api";
import InvitesPanel from "./invites-panel";
import { TagChip } from "./tag-chip";

/**
 * /admin · 营销管理模块（REQ-001 R4）：邀请管理（InvitesPanel 自包含，含 Token 消耗统计）
 * + 用户套餐管理（自 /profile 管理员区块迁移）。
 */
export default function AdminMarketingPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [grants, setGrants] = useState<Record<string, string[]>>({});

  interface AdminUser {
    id: string;
    nickname: string | null;
    phone: string | null;
    plan: string;
    planExpiresAt: string | null;
    used30d: number;
  }

  const loadUsers = useCallback(() => {
    api("/api/billing/users")
      .then((j) => setUsers(j.users))
      .catch(() => setUsers(null));
  }, []);

  // 模块授权矩阵（031）：user_id → module[]
  const loadGrants = useCallback(() => {
    api("/api/admin/grants")
      .then((j) => {
        const map: Record<string, string[]> = {};
        for (const g of j.grants ?? []) {
          (map[g.user_id] ??= []).push(g.module);
        }
        setGrants(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers();
    loadGrants();
  }, [loadUsers, loadGrants]);

  async function toggleModule(userId: string, module: "debt" | "trade_review", on: boolean) {
    try {
      if (on) await api("/api/admin/grants", "POST", { userId, module });
      else await api(`/api/admin/grants?userId=${userId}&module=${module}`, "DELETE");
    } catch {
      notify("模块授权失败", false);
      return;
    }
    notify(on ? "✅ 已授权" : "已撤销授权");
    loadGrants();
  }

  async function setPlan(userId: string, plan: "free" | "pro") {
    try {
      await api("/api/billing/plan", "POST", { userId, plan, months: 12 });
    } catch {
      notify("套餐变更失败", false);
      return;
    }
    notify(plan === "pro" ? "已开通 Pro（1 年）" : "已取消 Pro");
    loadUsers();
  }

  return (
    <div className="space-y-5">
      {/* 用户套餐管理 */}
      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">
          <TagChip icon="👤" label="用户套餐与模块授权" tone="sky" />
        </h2>
        <p className="mt-1.5 text-[10px] text-ink-faint">
          🏦负债 / 📈复盘 = 模块授权（点按钮切换，即时生效）；授权后用户财务页出现对应 tab
        </p>
        {!users ? (
          <p className="mt-2 text-xs text-ink-dim">加载中…</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {u.nickname ?? "未命名"}
                  <span className="ml-1.5 text-ink-faint">{u.phone ?? ""}</span>
                </span>
                <span className={u.plan === "pro" ? "font-medium text-amber-400" : "text-ink-mute"}>
                  {u.plan === "pro" ? "Pro" : "免费"}·30天{u.used30d}次
                </span>
                {(["debt", "trade_review"] as const).map((m) => {
                  const on = grants[u.id]?.includes(m) ?? false;
                  return (
                    <button
                      key={m}
                      onClick={() => toggleModule(u.id, m, !on)}
                      title={on ? "点击撤销授权" : "点击授权该模块"}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                        on
                          ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-sm"
                          : "border border-line-soft bg-surface/60 text-ink-faint hover:border-sky-500/50 hover:text-ink-soft"
                      }`}
                    >
                      {m === "debt" ? "🏦负债" : "📈复盘"} {on ? "✓" : ""}
                    </button>
                  );
                })}
                {u.plan === "pro" ? (
                  <button
                    onClick={() => setPlan(u.id, "free")}
                    className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-rose-500/50"
                  >
                    取消Pro
                  </button>
                ) : (
                  <button
                    onClick={() => setPlan(u.id, "pro")}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-warn transition hover:bg-amber-500/20"
                  >
                    升级Pro(1年)
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 邀请码 + 被邀请人 Token 消耗统计（InvitesPanel 自包含） */}
      <InvitesPanel />
    </div>
  );
}
