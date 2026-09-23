"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { TagChip } from "@/components/tag-chip";
import { PARTITION_META, type DatasetSpec } from "@/components/admin-data-panel/types";
import { USER_DATA_CAP } from "./use-admin-user-data";
import type { UserDataEntry } from "./types";

interface Props {
  userDataDraft: UserDataEntry[];
  setUserDataDraft: Dispatch<SetStateAction<UserDataEntry[]>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  userDataDirty: boolean;
  userDataEstChars: number;
  userDataOverCap: boolean;
  catalogDatasets: DatasetSpec[] | null;
  catalogLoading: boolean;
  onEnsureCatalog: () => void;
}

const clampInt = (raw: string, min: number, max: number) =>
  raw === "" ? undefined : Math.max(min, Math.min(max, Math.round(Number(raw) || min)));

/**
 * ===== 🧩 个性化注入（REQ-005 FR-5.6）：输入装配区块底部的独立折叠区，默认收起 =====
 * 数据集多选 chips（仅 behavior/derived 可选，category 置灰；最多 5 个）+ 每个已选数据集的
 * 天数（1~92）/ 条数上限（1~50）小输入 + 实时估算注入字符数（Σ limit×120 vs 8000，超限标红禁用保存）。
 * 上方注入开关 / caps / 模板编辑的功能与 UI 不受影响。
 */
export default function UserDataSection({
  userDataDraft,
  setUserDataDraft,
  setDirty,
  userDataDirty,
  userDataEstChars,
  userDataOverCap,
  catalogDatasets,
  catalogLoading,
  onEnsureCatalog,
}: Props) {
  const [open, setOpen] = useState(false);

  const toggleDataset = (key: string) => {
    setUserDataDraft((list) =>
      list.some((e) => e.dataset === key) ? list.filter((e) => e.dataset !== key) : [...list, { dataset: key, days: 7, limit: 10 }],
    );
    setDirty(true);
  };

  const patchEntry = (dataset: string, patch: Partial<UserDataEntry>) => {
    setUserDataDraft((list) => list.map((e) => (e.dataset === dataset ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-bg/20">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onEnsureCatalog();
        }}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`text-[10px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-xs font-medium text-ink">🧩 个性化注入</span>
        {userDataDraft.length > 0 && <TagChip label={`${userDataDraft.length}/5 数据集`} tone="violet" size="sm" />}
        {userDataDirty && <TagChip label="注入配置未保存" tone="amber" size="sm" />}
        <span className="flex-1" />
        <span className="text-[10px] text-ink-faint">把你的真实数据块装配进 user 输入</span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <p className="text-[11px] text-ink-faint">
            选择要注入的数据集（仅行为型 / AI 衍生可注入，类别型为维度表；最多 5 个，保存后装配期生效）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!catalogDatasets ? (
              <span className="text-[11px] text-ink-faint">{catalogLoading ? "数据目录加载中…" : "（目录暂不可用）"}</span>
            ) : (
              catalogDatasets.map((d) => {
                const on = userDataDraft.some((e) => e.dataset === d.key);
                const isCategory = d.partition === "category";
                const full = !on && userDataDraft.length >= 5;
                return (
                  <button
                    key={d.key}
                    disabled={isCategory || full}
                    onClick={() => toggleDataset(d.key)}
                    title={isCategory ? "类别型数据集为维度表，不参与个性化注入" : full ? "最多选择 5 个数据集" : d.desc}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                      on
                        ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-sm"
                        : isCategory
                          ? "cursor-not-allowed border border-line-soft bg-elevated text-ink-faint opacity-60"
                          : full
                            ? "cursor-not-allowed border border-line-soft bg-surface/60 text-ink-faint opacity-60"
                            : "border border-line-soft bg-surface/60 text-ink-mute hover:border-sky-500/50 hover:text-ink"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {d.name}
                    <span className="ml-1 font-mono text-[9px] opacity-70">{d.key}</span>
                  </button>
                );
              })
            )}
          </div>

          {userDataDraft.length > 0 && (
            <ul className="space-y-1">
              {userDataDraft.map((e) => {
                const d = catalogDatasets?.find((x) => x.key === e.dataset);
                return (
                  <li key={e.dataset} className="flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-bg/30 px-2.5 py-1.5 text-[11px]">
                    <TagChip label={d?.name ?? e.dataset} tone={d ? PARTITION_META[d.partition].tone : "slate"} size="sm" />
                    <span className="font-mono text-[9px] text-ink-faint">{e.dataset}</span>
                    <span className="flex-1" />
                    <label className="flex items-center gap-1 text-ink-dim" title="时间窗 1~92 天（留空 = 默认 30 天）">
                      天数
                      <input
                        type="number"
                        min={1}
                        max={92}
                        value={e.days ?? ""}
                        placeholder="默认 30"
                        onChange={(ev) => patchEntry(e.dataset, { days: clampInt(ev.target.value, 1, 92) })}
                        className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-right tabular-nums text-ink outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-ink-dim" title="条数上限 1~50（留空 = 服务端默认 10 条）">
                      条数上限
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={e.limit ?? ""}
                        placeholder="10"
                        onChange={(ev) => patchEntry(e.dataset, { limit: clampInt(ev.target.value, 1, 50) })}
                        className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-right tabular-nums text-ink outline-none focus:border-sky-500"
                      />
                    </label>
                    <button
                      onClick={() => toggleDataset(e.dataset)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-ink-mute transition hover:bg-rose-500/10 hover:text-danger"
                      title="移除该数据集"
                    >
                      移除
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className={`text-[11px] ${userDataOverCap ? "text-danger" : "text-ink-faint"}`}>
            预计注入 ≈ <span className="tabular-nums">{userDataEstChars}</span> / {USER_DATA_CAP} 字符（按 Σ条数上限×120 估算，线上装配超顶会截断）
            {userDataOverCap && " —— 超出上限，请下调条数或移除数据集（保存已禁用）"}
          </p>
        </div>
      )}
    </div>
  );
}
