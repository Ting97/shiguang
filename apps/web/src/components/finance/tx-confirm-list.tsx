/** 财务页草稿确认区（004 4-G 自 page.tsx 拆出）：待确认流水 + 单笔/全部确认（流水不入账，确认即计入报表） */
"use client";

import { TagChip } from "@/components/tag-chip";
import type { Tx } from "./kit";
import { TxRow } from "./display";

export function DraftConfirmSection({
  drafts,
  confirmBusy,
  onConfirm,
  onConfirmAll,
  onEdit,
  onRemove,
  delArmed,
}: {
  drafts: Tx[];
  confirmBusy: boolean;
  onConfirm: (t: Tx) => Promise<void>;
  onConfirmAll: () => Promise<void>;
  onEdit: (t: Tx) => void;
  onRemove: (t: Tx) => void;
  /** 处于删除待确认态的流水 id */
  delArmed?: string | null;
}) {
  if (drafts.length === 0) return null;
  return (
    <section id="draft-area" className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-warn">
          <TagChip icon="📥" label="待确认流水" tone="amber" />
          <span className="text-xs font-normal text-warn/60">来自动态识别 · 确认后计入报表</span>
        </h2>
        <button
          disabled={confirmBusy}
          onClick={() => void onConfirmAll()}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-warn transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {confirmBusy ? "确认中…" : "⚡ 全部确认"}
        </button>
      </div>
      <ul className="space-y-2">
        {drafts.map((t) => (
          <li key={t.id} className="force-actions group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/20 bg-bg/50 px-3 py-2.5">
            <TxRow tx={t} onConfirm={() => onConfirm(t)} onEdit={() => onEdit(t)} onDelete={() => onRemove(t)} delArmed={delArmed === t.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
