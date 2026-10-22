"use client";

import { useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import Switch from "./switch";
import { TagChip } from "./tag-chip";
import { useSession } from "@/shared/session";

/**
 * 【我的】→ 功能管理（REQ-028 FR-A6 用户自选层）：
 * 仅渲染 controllable=true 的模块（core/强制中/管理员禁自选的不出现）；
 * 按域分组（域级行 + 缩进子模块行）；父域关闭时子项禁用并提示；
 * 拨动 → PATCH /api/auth/module-prefs → setUser(返回的新 me) 即时显隐（导航/入口随之刷新）。
 */
export default function ModulePrefsSection() {
  const { user: me, setUser } = useSession();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const prefs = me?.modulePrefs ?? [];
  const controllable = prefs.filter((p) => p.controllable);

  async function toggle(key: string, name: string, next: boolean) {
    if (busyRef.current) return; // 防连点：服务端返回前不重复提交
    busyRef.current = true;
    setBusy(true);
    try {
      // 返回体即新 me()：直接 setUser，导航/入口即时显隐（无需整页刷新）
      const j = await api<typeof me>("/api/auth/module-prefs", "PATCH", { module: key, enabled: next });
      setUser(j);
      toast(next ? `✅ ${name}已开启` : `${name}已关闭（数据保留，随时可再开启）`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!me) return null;
  if (me.isAdmin) {
    return (
      <section className="glass mb-5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">
          <TagChip icon={<LayoutGrid size={12} />} label="功能管理" tone="sky" />
        </h2>
        <p className="mt-1.5 text-micro text-ink-dim">管理员账号全模块直通，无需自选开关。</p>
      </section>
    );
  }
  if (controllable.length === 0) {
    return (
      <section className="glass mb-5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-ink-soft">
          <TagChip icon={<LayoutGrid size={12} />} label="功能管理" tone="sky" />
        </h2>
        <p className="mt-1.5 text-micro text-ink-dim">当前没有可自行开关的模块。</p>
      </section>
    );
  }

  const effOf = (key: string | null): boolean => {
    if (!key) return true;
    return prefs.find((p) => p.key === key)?.effective ?? false;
  };

  return (
    <section className="glass mb-5 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-ink-soft">
        <TagChip icon={<LayoutGrid size={12} />} label="功能管理" tone="sky" />
      </h2>
      <p className="mt-1.5 text-micro text-ink-dim">
        按需开关功能模块：关闭即隐藏入口（数据保留不删），重新开启即恢复。
      </p>
      <ul className="mt-3 space-y-1">
        {controllable.map((p) => {
          const parentOn = effOf(p.parent);
          return (
            <li
              key={p.key}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                p.effective && parentOn ? "border-line-soft bg-surface/60" : "border-line-soft/60 bg-wash/40"
              }`}
              style={p.level === "submodule" ? { marginLeft: 24 } : undefined}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.name}</span>
              {!parentOn && p.parent && (
                <span className="shrink-0 text-micro text-ink-faint">先开启上级模块</span>
              )}
              <Switch
                checked={p.effective && parentOn}
                disabled={busy || !parentOn}
                onChange={(next) => toggle(p.key, p.name, next)}
                // title 与 checked 同口径：父模块关闭时开关显示为关，tooltip 不得提示「点击关闭」
                title={p.effective && parentOn ? "点击关闭" : "点击开启"}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
