"use client";

import { TagChip } from "@/components/tag-chip";
import { MODE_META } from "./kit";
import type { EngineMode } from "./types";

interface Props {
  mode: EngineMode;
  envDefault: EngineMode;
  saving: boolean;
  onSwitch: (mode: EngineMode) => void;
}

/** 调用引擎模式开关（REQ-003 3-C 管理台开关） */
export default function EngineModeCard({ mode: engineMode, envDefault: engineEnvDefault, saving: engineSaving, onSwitch }: Props) {
  return (
    <div className="glass mb-4 rounded-2xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">🧭 调用引擎模式</h3>
        <TagChip label="Jev 影子观察期" tone="amber" size="sm" />
        <span className="flex-1" />
        <span className="text-[10px] text-ink-faint">服务器 env 默认：{MODE_META[engineEnvDefault].label}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {(Object.keys(MODE_META) as EngineMode[]).map((m) => {
          const active = engineMode === m;
          return (
            <button
              key={m}
              onClick={() => onSwitch(m)}
              disabled={engineSaving}
              title="点击切换，立即生效"
              className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${
                active
                  ? "border-sky-500/60 bg-sky-500/10"
                  : "border-line-soft bg-bg/30 hover:border-sky-500/40"
              }`}
            >
              <span className={`flex items-center gap-1.5 text-xs font-medium ${active ? "text-accent" : "text-ink"}`}>
                {MODE_META[m].label}
                {active && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-accent">生效中</span>}
                {engineSaving && <span className="text-[9px] text-ink-faint">切换中…</span>}
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-ink-dim">{MODE_META[m].desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
