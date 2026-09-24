/** 财务页已确认流水列表（004 4-G 自 page.tsx 拆出）：流水列表 + 行内编辑 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { Dismissable } from "@/components/dismissable";
import { TagChip } from "@/components/tag-chip";
import type { Account, Tx } from "./kit";
import { TxRow } from "./display";
import { TxForm } from "./forms";

export function ConfirmedTxSection({
  txs,
  accounts,
  editing,
  setEditing,
  onSubmitEdit,
  onRemove,
  delArmed,
}: {
  txs: Tx[];
  accounts: Account[];
  editing: Tx | null;
  setEditing: Dispatch<SetStateAction<Tx | null>>;
  onSubmitEdit: (t: Tx, payload: Record<string, unknown>) => Promise<void>;
  onRemove: (t: Tx) => void;
  /** 处于删除待确认态的流水 id */
  delArmed?: string | null;
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
        <TagChip icon="🧾" label="流水" tone="slate" />
        <span className="text-xs font-normal text-ink-dim">{txs.length} 笔</span>
      </h2>
      {txs.length === 0 && (
        <p className="py-4 text-center text-xs text-ink-faint">
          本月还没有流水 —— 说句"打车花了30"，或点「＋ 记一笔」
        </p>
      )}
      <ul className="space-y-1">
        {txs.map((t) =>
          editing?.id === t.id ? (
            <li key={t.id} className="rounded-xl border border-sky-500/40 bg-elevated/60 p-3">
              <Dismissable onClose={() => setEditing(null)}>
                <TxForm
                  accounts={accounts}
                  initial={t}
                  onCancel={() => setEditing(null)}
                  onSubmit={(payload) => onSubmitEdit(t, payload)}
                />
              </Dismissable>
            </li>
          ) : (
            <li key={t.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 hover:bg-elevated/60">
              <TxRow tx={t} onEdit={() => setEditing(t)} onDelete={() => onRemove(t)} delArmed={delArmed === t.id} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
