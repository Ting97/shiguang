"use client";

import { useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { TX_CATEGORIES } from "@/lib/finance";
import { api } from "@/shared/api";
import { TagChip } from "../tag-chip";
import { RowAction } from "./row-action";
import { yuan } from "./kit";
import type { DelFn, RunFn } from "./types";

/** 金额流水行内编辑态 */
interface EditTxState {
  id: string;
  direction: string;
  amount: string;
  category: string;
  counterparty: string;
}

interface TxRowsProps {
  m: FeedMoment;
  run: RunFn;
  del: DelFn;
}

/** ---- 金额流水 ----：展示 + 行内编辑/删除 */
export function TxRows({ m, run, del }: TxRowsProps) {
  const [editTx, setEditTx] = useState<EditTxState | null>(null);

  return (
    <>
      {m.transactions.map((x) =>
        editTx?.id === x.id ? (
          <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
            <select
              value={editTx.direction}
              onChange={(e) => setEditTx({ ...editTx, direction: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
            >
              <option value="out">支出</option>
              <option value="in">收入</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={editTx.amount}
              onChange={(e) => setEditTx({ ...editTx, amount: e.target.value })}
              className="w-24 rounded border border-line-strong bg-surface px-2 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
              placeholder="金额(元)"
            />
            <select
              value={editTx.category}
              onChange={(e) => setEditTx({ ...editTx, category: e.target.value })}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
            >
              {TX_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              value={editTx.counterparty}
              onChange={(e) => setEditTx({ ...editTx, counterparty: e.target.value })}
              className="w-24 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
              placeholder="对方(可空)"
            />
            <span className="flex gap-1">
              <button onClick={() => setEditTx(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
              <button
                onClick={() =>
                  run(async () => {
                    const cents = Math.round(parseFloat(editTx.amount) * 100);
                    if (!Number.isFinite(cents) || cents <= 0) throw new Error("金额必须大于 0");
                    await api(`/api/transactions/${x.id}`, "PATCH", {
                      direction: editTx.direction,
                      amountCents: cents,
                      category: editTx.category,
                      counterparty: editTx.counterparty,
                    });
                    setEditTx(null);
                    return "💾 金额已更新";
                  })
                }
                className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
              >
                保存
              </button>
            </span>
          </div>
        ) : (
          <p key={x.id} className="group/row flex items-center gap-x-2 text-ink-mute">
            <TagChip
              icon="💰"
              label={`${x.direction === "out" ? "支出" : "收入"} ${yuan(x.amountCents)}`}
              tone={x.direction === "out" ? "rose" : "emerald"}
              size="sm"
              className="shrink-0"
            />
            <span className="min-w-0 truncate">
              {x.category}
              {x.counterparty ? ` · 对方：${x.counterparty}` : ""}
            </span>
            <RowAction
              onEdit={() =>
                setEditTx({
                  id: x.id,
                  direction: x.direction,
                  amount: String(x.amountCents / 100),
                  category: TX_CATEGORIES.includes(x.category) ? x.category : "其他",
                  counterparty: x.counterparty ?? "",
                })
              }
              onDelete={() => del(`删除这笔金额记录？（${x.direction === "out" ? "支出" : "收入"} ${yuan(x.amountCents)}）`, () =>
                api(`/api/transactions/${x.id}`, "DELETE"))}
            />
          </p>
        ),
      )}
    </>
  );
}
