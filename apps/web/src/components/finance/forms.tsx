"use client";

import { useState } from "react";
import { Dismissable } from "@/components/dismissable";
import { TX_CATEGORIES } from "@/lib/finance";
import type { Account, Tx } from "./kit";
import { api, toLocalInput } from "./kit";

export function TxForm({
  accounts,
  initial,
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  initial?: Tx | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [direction, setDirection] = useState<"out" | "in">(initial?.direction ?? "out");
  const [amount, setAmount] = useState(initial ? String(initial.amount_cents / 100) : "");
  const [category, setCategory] = useState(initial?.category ?? "餐饮");
  const [accountId, setAccountId] = useState<string>(initial?.account_id ?? "");
  const [date, setDate] = useState(
    initial
      ? toLocalInput(initial.occurred_at).slice(0, 16)
      : toLocalInput(new Date().toISOString()).slice(0, 16),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
              direction === d
                ? d === "out"
                  ? "bg-rose-600 text-white"
                  : "bg-emerald-600 text-white"
                : "bg-elevated text-ink-mute hover:bg-soft"
            }`}
          >
            {d === "out" ? "支出" : "收入"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <span className="flex items-center text-lg text-ink-dim">¥</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="金额"
          className="w-28 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
        >
          {TX_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
        >
          <option value="">不记账户</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="对方（可空）"
          title="和谁有关 —— 填了会关联到 TA 的人情账（如：老王）"
          className="w-24 shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <input
          value={note ?? ""}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可空）"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">
          取消
        </button>
        <button
          disabled={busy || !amount}
          onClick={async () => {
            const cents = Math.round(parseFloat(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0) return;
            setBusy(true);
            try {
              await onSubmit({
                direction,
                amountCents: cents,
                category,
                accountId: accountId || null,
                occurredAt: date ? new Date(date).toISOString() : new Date().toISOString(),
                note: note || null,
                counterparty: counterparty.trim() || null,
              });
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : initial ? "保存" : "记入"}
        </button>
      </div>
    </div>
  );
}

/** 账户管理：新增（含期初余额）+ 行内改名/改图标 + 期初余额 + 归档（C1 FR-C1.5） */
export function AccountManager({ accounts, onChanged }: { accounts: Account[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💳");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const ICONS = ["💵", "🅰", "💬", "💳", "🏦", "📈", "🎓", "🏠"];
  // 行内改名草稿与错误提示（重名 400 就地显示）
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [rowErr, setRowErr] = useState<Record<string, string | null>>({});
  // 图标选择浮层（打开的账户 id）
  const [iconPick, setIconPick] = useState<string | null>(null);

  async function saveName(a: Account) {
    const draft = (nameDrafts[a.id] ?? a.name).trim();
    setRowErr((e) => ({ ...e, [a.id]: null }));
    if (!draft || draft === a.name) return;
    try {
      await api(`/api/accounts/${a.id}`, "PATCH", { name: draft });
      await onChanged();
    } catch (err) {
      setRowErr((e) => ({ ...e, [a.id]: err instanceof Error ? err.message : "改名失败" }));
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {accounts.map((a) => (
          <li key={a.id} className="group rounded-lg border border-line-soft bg-bg/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIconPick(iconPick === a.id ? null : a.id)}
                title="点击更换图标"
                className="shrink-0 rounded px-0.5 text-lg transition hover:bg-soft"
              >
                {a.icon}
              </button>
              <input
                value={nameDrafts[a.id] ?? a.name}
                onChange={(e) => setNameDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                onBlur={() => void saveName(a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveName(a);
                }}
                maxLength={20}
                title="点击编辑账户名，回车或移开焦点保存"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition focus:border-sky-500 focus:bg-surface"
              />
              <input
                type="number"
                step="0.01"
                defaultValue={a.opening_balance_cents / 100}
                title="期初余额（元）"
                onBlur={async (e) => {
                  const v = Math.round(parseFloat(e.target.value) * 100);
                  if (Number.isFinite(v) && v !== a.opening_balance_cents) {
                    await api(`/api/accounts/${a.id}`, "PATCH", { openingBalanceCents: v });
                    await onChanged();
                  }
                }}
                className="w-24 rounded border border-line bg-surface px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-sky-500"
              />
              <button
                title="归档账户（历史流水保留）"
                onClick={async () => {
                  if (!window.confirm(`归档「${a.name}」？归档后不再显示，历史流水保留。`)) return;
                  await api(`/api/accounts/${a.id}`, "DELETE");
                  await onChanged();
                }}
                className="row-actions-hidden hidden text-xs text-ink-dim hover:text-danger group-hover:block"
              >
                🗑
              </button>
            </div>
            {rowErr[a.id] && <p className="mt-1 text-[11px] text-danger">{rowErr[a.id]}</p>}
            {iconPick === a.id && (
              <Dismissable onClose={() => setIconPick(null)} className="mt-2 rounded-lg border border-line-soft bg-surface p-2">
                <div className="flex flex-wrap gap-1.5">
                  {ICONS.map((i) => (
                    <button
                      key={i}
                      onClick={async () => {
                        setIconPick(null);
                        if (i === a.icon) return;
                        await api(`/api/accounts/${a.id}`, "PATCH", { icon: i });
                        await onChanged();
                      }}
                      className={`h-8 w-8 rounded-lg text-lg transition hover:bg-soft ${i === a.icon ? "bg-sky-500/15 ring-1 ring-sky-500" : ""}`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </Dismissable>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-line-soft pt-3">
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none">
          {ICONS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新账户名（如：招行储蓄卡）"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <input
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          type="number"
          step="0.01"
          placeholder="期初余额"
          title="期初余额（元），可留空"
          className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:border-sky-500"
        />
        <button
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const cents = opening ? Math.round(parseFloat(opening) * 100) : 0;
              await api("/api/accounts", "POST", { name: name.trim(), icon, openingBalanceCents: Number.isFinite(cents) ? cents : 0 });
              setName("");
              setOpening("");
              await onChanged();
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded-lg px-4 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </div>
  );
}
