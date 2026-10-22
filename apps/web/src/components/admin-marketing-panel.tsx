"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock, PowerOff, User } from "lucide-react";
import { api } from "@/shared/api";
import InvitesPanel from "./invites-panel";
import { TagChip } from "./tag-chip";
import { MODULE_REGISTRY } from "@shiguangri/shared/modules";

/**
 * /admin · 营销管理模块（REQ-001 R4 + REQ-028 FR-A5）：邀请管理（InvitesPanel 自包含）
 * + 用户套餐管理 + 按用户模块覆盖矩阵（三态：跟随/强制开/强制关 + 可见性三态：跟随/可见/隐藏）。
 */

/** 矩阵列 = 全部非 core 模块（core 无覆盖意义） */
const MATRIX_MODULES = MODULE_REGISTRY.filter((m) => !m.core);

type ForceState = "on" | "off" | null;
type VisibleState = boolean | null;

interface Override {
  force: ForceState;
  visible: VisibleState;
}

export default function AdminMarketingPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  // 用户列表加载失败原因：置 null 会永远停在「加载中…」，需落错误终态 + 重试入口
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, Override>>>({});
  // 授权/套餐变更进行中锁（ref：按钮未接 disabled，用 ref 才拦得住快速连点）
  const mutatingRef = useRef(false);

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
      .then((j) => {
        setUsers(j.users);
        setUsersErr(null);
      })
      .catch((e) => {
        // 失败不再置 null（那会永远「加载中」），落错误终态给重试按钮
        setUsersErr(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // 覆盖矩阵加载失败原因：静默吞错会让矩阵整表显示「跟随」，管理员据此做三态切换
  // 第一次点击就写出与意图相反的覆盖——落错误终态禁写 + 重试入口
  const [overridesErr, setOverridesErr] = useState<string | null>(null);
  // 按用户覆盖矩阵（REQ-028）：user_id → module → {force, visible}
  const loadOverrides = useCallback(() => {
    api("/api/admin/grants")
      .then((j) => {
        const map: Record<string, Record<string, Override>> = {};
        for (const g of j.grants ?? []) {
          (map[g.user_id] ??= {})[g.module] = {
            force: g.force_state ?? null,
            visible: g.switch_visible ?? null,
          };
        }
        setOverrides(map);
        setOverridesErr(null);
      })
      .catch((e) => {
        setOverridesErr(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    loadUsers();
    loadOverrides();
  }, [loadUsers, loadOverrides]);

  /** 写覆盖（undefined 维度不动）；失败重载。 */
  async function setOverride(
    userId: string,
    module: string,
    patch: { force_state?: ForceState; switch_visible?: VisibleState },
    okText: string,
  ) {
    if (mutatingRef.current) return; // 防连点重复提交
    if (overridesErr) {
      // 当前态未知（矩阵没加载出来）：显示的「跟随」不可信，禁止写入防误覆盖
      notify("覆盖矩阵加载失败，请先重试加载", false);
      return;
    }
    mutatingRef.current = true;
    try {
      await api("/api/admin/grants", "POST", { userId, module, ...patch });
    } catch {
      notify("覆盖写入失败", false);
      loadOverrides();
      return;
    } finally {
      mutatingRef.current = false;
    }
    notify(okText);
    loadOverrides();
  }

  /** 三态循环：跟随 → 强制开 → 强制关 → 跟随 */
  function cycleForce(userId: string, module: string, cur: ForceState) {
    const next: ForceState = cur === null ? "on" : cur === "on" ? "off" : null;
    void setOverride(
      userId,
      module,
      { force_state: next },
      next === null ? "已恢复跟随全局" : next === "on" ? "✅ 已强制开启（仅该用户）" : "已强制关闭（仅该用户）",
    );
  }

  /** 可见性三态循环：跟随 → 可见 → 隐藏 → 跟随 */
  function cycleVisible(userId: string, module: string, cur: VisibleState) {
    const next: VisibleState = cur === null ? true : cur === true ? false : null;
    void setOverride(
      userId,
      module,
      { switch_visible: next },
      next === null ? "可见性恢复跟随" : next ? "【我的】已展示该开关" : "【我的】已隐藏该开关",
    );
  }

  async function setPlan(userId: string, plan: "free" | "pro") {
    if (mutatingRef.current) return; // 防连点重复提交
    mutatingRef.current = true;
    try {
      await api("/api/billing/plan", "POST", { userId, plan, months: 12 });
    } catch {
      notify("套餐变更失败", false);
      return;
    } finally {
      mutatingRef.current = false;
    }
    notify(plan === "pro" ? "已开通 Pro（1 年）" : "已取消 Pro");
    loadUsers();
  }

  return (
    <div className="space-y-5">
      {/* 用户套餐 + 按用户模块覆盖矩阵 */}
      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">
          <TagChip icon={<User size={12} />} label="用户套餐与模块覆盖" tone="sky" />
        </h2>
        <p className="mt-1.5 text-badge text-ink-faint">
          主按钮三态循环：跟随全局 → 强制开 → 强制关（仅该用户）；眼睛按钮控制【我的 → 功能管理】里是否展示该开关项。全局开关在「模块」tab。
        </p>
        {overridesErr && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <p className="text-danger">覆盖矩阵加载失败：{overridesErr}（写入已禁用）</p>
            <button onClick={loadOverrides} className="btn-primary rounded-lg px-3 py-1 text-micro font-medium">
              重试
            </button>
          </div>
        )}
        {usersErr ? (
          <div className="mt-2 text-xs">
            <p className="text-danger">加载失败：{usersErr}</p>
            <button onClick={loadUsers} className="btn-primary mt-2 rounded-lg px-4 py-1.5 text-micro font-medium">
              重试
            </button>
          </div>
        ) : !users ? (
          <p className="mt-2 text-xs text-ink-dim">加载中…</p>
        ) : (
          <div className="scrollbar-none mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface/95 px-2 py-1.5 text-left font-medium text-ink-dim backdrop-blur">用户</th>
                  {MATRIX_MODULES.map((m) => (
                    <th key={m.key} title={`${m.name}（${m.key}）`} className="px-1 py-1.5 text-center font-medium text-ink-dim">
                      {m.name}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-left font-medium text-ink-dim">套餐</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line-soft/60">
                    <td className="sticky left-0 z-10 max-w-[9rem] truncate bg-surface/95 px-2 py-1.5 backdrop-blur">
                      <span className="text-ink">{u.nickname ?? "未命名"}</span>
                      <span className="ml-1 text-ink-faint">{u.phone ?? ""}</span>
                    </td>
                    {MATRIX_MODULES.map((m) => {
                      const ov = overrides[u.id]?.[m.key];
                      const force: ForceState = ov?.force ?? null;
                      const visible: VisibleState = ov?.visible ?? null;
                      return (
                        <td key={m.key} className="whitespace-nowrap px-1 py-1 text-center">
                          <button
                            onClick={() => cycleForce(u.id, m.key, force)}
                            title={
                              force === null
                                ? "跟随全局（点击强制开）"
                                : force === "on"
                                  ? "已强制开（点击强制关）"
                                  : "已强制关（点击恢复跟随）"
                            }
                            className={`tap-lg inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                              force === "on"
                                ? "bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-sm"
                                : force === "off"
                                  ? "bg-rose-500/15 text-danger"
                                  : "border border-line-soft bg-surface/60 text-ink-faint hover:border-sky-500/40 hover:text-ink-soft"
                            }`}
                          >
                            {force === "on" ? (
                              <PowerOff size={11} className="rotate-180" aria-hidden />
                            ) : force === "off" ? (
                              <Lock size={11} aria-hidden />
                            ) : (
                              <span className="text-micro">跟</span>
                            )}
                          </button>
                          <button
                            onClick={() => cycleVisible(u.id, m.key, visible)}
                            title={
                              visible === null
                                ? "开关可见性跟随全局（点击强制可见）"
                                : visible
                                  ? "【我的】强制展示该开关（点击强制隐藏）"
                                  : "【我的】强制隐藏该开关（点击恢复跟随）"
                            }
                            className={`tap-lg ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                              visible === true
                                ? "bg-sky-500/15 text-accent"
                                : visible === false
                                  ? "bg-wash text-ink-mute"
                                  : "text-ink-faint/50 hover:text-ink-soft"
                            }`}
                          >
                            {visible === false ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={u.plan === "pro" ? "font-medium text-amber-400" : "text-ink-mute"}>
                        {u.plan === "pro" ? "Pro" : "免费"}·{u.used30d}次
                      </span>
                      {u.plan === "pro" ? (
                        <button
                          onClick={() => setPlan(u.id, "free")}
                          className="ml-2 rounded-lg border border-line-soft bg-surface/60 px-2 py-0.5 text-micro text-ink-soft transition hover:border-rose-500/50"
                        >
                          取消Pro
                        </button>
                      ) : (
                        <button
                          onClick={() => setPlan(u.id, "pro")}
                          className="ml-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-micro font-medium text-warn transition hover:bg-amber-500/20"
                        >
                          升级
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 邀请码 + 被邀请人 Token 消耗统计（InvitesPanel 自包含） */}
      <InvitesPanel />
    </div>
  );
}
