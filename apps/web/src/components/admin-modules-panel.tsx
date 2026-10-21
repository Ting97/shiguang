"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { api } from "@/shared/api";
import { TagChip } from "./tag-chip";
import Switch from "./switch";

interface AdminModule {
  key: string;
  name: string;
  level: "domain" | "submodule";
  parent: string | null;
  core: boolean;
  configured: boolean;
  enabled: boolean;
  userToggleable: boolean;
  defaultEnabled: boolean;
  defaultUserToggleable: boolean;
  userOverrides: number;
  updatedAt: string | null;
}

/**
 * /admin · 模块面板（REQ-028 全局层）：注册表 + module_states 合并视图。
 * 双开关：模块全局开关 / 允许用户自开关；core 只读；保存即时生效（全清服务端缓存）。
 */
export default function AdminModulesPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [modules, setModules] = useState<AdminModule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/admin/modules")
      .then((j) => {
        setModules(j.modules);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  // 写入进行中锁（admin-marketing-panel 同款 ref 口径）：快速连点开关会并发两个语义
  // 相反的 PATCH，最终态取决于到达顺序，UI 靠 reload 兜底出现短暂不一致
  const mutatingRef = useRef(false);
  async function patch(m: AdminModule, field: "enabled" | "userToggleable", next: boolean) {
    if (mutatingRef.current) return;
    mutatingRef.current = true;
    // 乐观更新：失败回滚重载
    setModules((prev) => prev?.map((x) => (x.key === m.key ? { ...x, [field]: next } : x)) ?? prev);
    try {
      await api("/api/admin/modules", "PATCH", { module: m.key, [field]: next });
      notify(`✅ ${m.name} 已${field === "enabled" ? (next ? "开启" : "关闭") : next ? "允许用户自开关" : "禁止用户自开关"}`);
      load();
    } catch (e) {
      notify(`保存失败：${e instanceof Error ? e.message : String(e)}`, false);
      load();
    } finally {
      mutatingRef.current = false;
    }
  }

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-ink-soft">
        <TagChip icon={<Puzzle size={12} />} label="模块开关（全局层）" tone="violet" />
      </h2>
      <p className="mt-1.5 text-badge text-ink-faint">
        关闭后全站隐藏该模块入口（数据保留不删）；「允许用户自开关」控制用户能否在【我的 → 功能管理】自行关闭。逐用户的强制开/关在「营销管理」tab 设置。
      </p>
      {err ? (
        <div className="mt-3 text-xs">
          <p className="text-danger">加载失败：{err}</p>
          <button onClick={load} className="btn-primary mt-2 rounded-lg px-4 py-1.5 text-micro font-medium">
            重试
          </button>
        </div>
      ) : !modules ? (
        <p className="mt-3 text-xs text-ink-dim">加载中…</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {modules.map((m) => (
            <li
              key={m.key}
              className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                m.enabled ? "border-line-soft bg-surface/60" : "border-line-soft/60 bg-wash/40"
              }`}
              style={m.level === "submodule" ? { marginLeft: 28 } : undefined}
            >
              <span className="min-w-[5.5rem] font-medium text-ink">
                {m.name}
                {m.core && <span className="ml-1.5 text-micro text-ink-faint">核心</span>}
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <Switch
                  checked={m.enabled}
                  disabled={m.core}
                  onChange={(next) => patch(m, "enabled", next)}
                  title={m.core ? "核心模块不可关闭" : m.enabled ? "点击关闭（全站）" : "点击开启（全站）"}
                />
                全局{m.enabled ? "开" : "关"}
                {!m.configured && <span className="text-micro text-ink-faint">（默认）</span>}
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <Switch
                  checked={m.userToggleable}
                  disabled={m.core}
                  onChange={(next) => patch(m, "userToggleable", next)}
                  title="允许用户在【我的 → 功能管理】自行开关该模块"
                />
                {m.userToggleable ? "用户可自选" : "禁止自选"}
              </span>
              <span className="ml-auto flex items-center gap-2 text-micro text-ink-faint">
                {m.userOverrides > 0 && <span title="「营销管理」里有针对个别用户的覆盖">个别覆盖 {m.userOverrides} 人</span>}
                <span className="font-mono">{m.key}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
