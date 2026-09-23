/** 财务页草稿确认区（004 4-G 自 page.tsx 拆出）：待确认流水 + 单笔/全部入账入口 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { Dismissable } from "@/components/dismissable";
import { TagChip } from "@/components/tag-chip";
import type { Account, Tx } from "./kit";
import { TxRow } from "./display";

export function DraftConfirmSection({
  drafts,
  accounts,
  confirming,
  setConfirming,
  confirmAll,
  setConfirmAll,
  confirmBusy,
  onConfirm,
  onConfirmAll,
  onEdit,
  onRemove,
}: {
  drafts: Tx[];
  accounts: Account[];
  confirming: Tx | null;
  setConfirming: Dispatch<SetStateAction<Tx | null>>;
  confirmAll: boolean;
  setConfirmAll: Dispatch<SetStateAction<boolean>>;
  confirmBusy: boolean;
  onConfirm: (accountId: string | null) => Promise<void>;
  onConfirmAll: (accountId: string | null) => Promise<void>;
  onEdit: (t: Tx) => void;
  onRemove: (t: Tx) => void;
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
          onClick={() => setConfirmAll((v) => !v)}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-warn transition hover:bg-amber-500/20"
        >
          {confirmAll ? "收起" : "⚡ 全部入账"}
        </button>
      </div>
      {confirmAll && (
        <Dismissable onClose={() => setConfirmAll(false)} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/20 bg-bg/50 px-3 py-2.5 text-xs">
          <span className="text-ink-soft">把这 {drafts.length} 笔全部记入：</span>
          {accounts.map((a) => (
            <button
              key={a.id}
              disabled={confirmBusy}
              onClick={() => onConfirmAll(a.id)}
              className="rounded-full bg-elevated px-3 py-1 text-[11px] text-ink transition hover:bg-sky-600 disabled:opacity-40"
            >
              {a.icon} {a.name}
            </button>
          ))}
          <button disabled={confirmBusy} onClick={() => onConfirmAll(null)} className="rounded-full px-3 py-1 text-[11px] text-ink-mute hover:text-accent disabled:opacity-40">
            不记账户
          </button>
          <button onClick={() => setConfirmAll(false)} className="ml-auto text-[11px] text-ink-dim hover:text-ink-soft">
            取消
          </button>
        </Dismissable>
      )}
      <ul className="space-y-2">
        {drafts.map((t) => (
          <li key={t.id} className="force-actions group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/20 bg-bg/50 px-3 py-2.5">
            {confirming?.id === t.id ? (
              <Dismissable onClose={() => setConfirming(null)} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink-soft">记入账户：</span>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    disabled={confirmBusy}
                    onClick={() => onConfirm(a.id)}
                    className="rounded-full bg-elevated px-3 py-1 text-[11px] text-ink transition hover:bg-sky-600 disabled:opacity-40"
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
                <button disabled={confirmBusy} onClick={() => onConfirm(null)} className="rounded-full px-3 py-1 text-[11px] text-ink-mute hover:text-accent disabled:opacity-40">
                  不记账户
                </button>
                <button onClick={() => setConfirming(null)} className="ml-auto text-[11px] text-ink-dim hover:text-ink-soft">
                  取消
                </button>
              </Dismissable>
            ) : (
              <TxRow tx={t} onConfirm={() => setConfirming(t)} onEdit={() => onEdit(t)} onDelete={() => onRemove(t)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
