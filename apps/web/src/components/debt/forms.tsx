"use client";

import { useState } from "react";
import { useDismiss } from "@/components/dismissable";
import { DEBT_TYPES, DEBT_TYPE_META, type DebtType } from "@/lib/finance";
import type { Debt, Account } from "./kit";
import { fmt, bjToday, api } from "./kit";

/** 余额曲线 sparkline：本金 → 逐笔还款后的余额（最近 12 个点） */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={ref} className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-dim hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-sky-500";

export function DebtForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: Debt | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<DebtType>(initial?.type ?? "credit_card");
  const [principal, setPrincipal] = useState(initial ? String(initial.principal_cents / 100) : "");
  const [balance, setBalance] = useState(initial ? String(initial.balance_cents / 100) : "");
  const [rate, setRate] = useState(initial ? String(initial.rate_pct) : "");
  const [monthly, setMonthly] = useState(initial?.monthly_cents != null ? String(initial.monthly_cents / 100) : "");
  const [payDay, setPayDay] = useState(initial?.pay_day ? String(initial.pay_day) : "");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [priority, setPriority] = useState(initial ? String(initial.priority) : "0");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  // 提交失败就地提示（历史 bug：try/finally 无 catch，失败静默 + unhandled rejection 触发整页刷新清空表单）
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（如：招行信用卡）" maxLength={40} className={inputCls} />
        <select value={type} onChange={(e) => setType(e.target.value as DebtType)} className="w-32 shrink-0 rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm outline-none focus:border-sky-500">
          {DEBT_TYPES.map((t) => (
            <option key={t} value={t}>{DEBT_TYPE_META[t].icon} {DEBT_TYPE_META[t].label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-mute">
          本金（元）
          <input type="number" min="0" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="原始本金" className={inputCls} />
        </label>
        <label className="text-[11px] text-ink-mute">
          当前余额（元）
          <input type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="默认=本金" className={inputCls} />
        </label>
        <label className="text-[11px] text-ink-mute">
          年化利率 %
          <input type="number" min="0" max="36" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0~36" className={inputCls} />
        </label>
        <label className="text-[11px] text-ink-mute">
          月供（元，亲友可空）
          <input type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="可空" className={inputCls} />
        </label>
        <label className="text-[11px] text-ink-mute">
          每月还款日
          <input type="number" min="1" max="31" value={payDay} onChange={(e) => setPayDay(e.target.value)} placeholder="1~31 可空" className={inputCls} />
        </label>
        <label className="text-[11px] text-ink-mute">
          到期/结清日
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-ink-mute">
          优先级
          <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} title="数字越小越优先" className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可空）" className={inputCls} />
      </div>
      {err && <p className="text-[11px] text-danger">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
        <button
          disabled={busy || !name.trim() || !principal}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const cents = (v: string, fallback: number | null = null) => {
                const n = Math.round(parseFloat(v) * 100);
                return Number.isFinite(n) ? n : fallback;
              };
              await onSubmit({
                name: name.trim(),
                type,
                principalCents: cents(principal, 0),
                ...(balance ? { balanceCents: cents(balance, 0) } : {}),
                ratePct: Number.isFinite(parseFloat(rate)) ? parseFloat(rate) : 0,
                monthlyCents: monthly ? cents(monthly, 0) : null,
                payDay: payDay ? Number(payDay) : null,
                dueDate: dueDate || null,
                priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
                note: note || null,
              });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : initial ? "保存" : "建档"}
        </button>
      </div>
    </div>
  );
}

export function PaymentForm({
  debt,
  accounts,
  onCancel,
  onDone,
  onError,
}: {
  debt: Debt;
  accounts: Account[];
  onCancel: () => void;
  onDone: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const suggest = debt.monthly_cents != null ? debt.monthly_cents / 100 : Math.min(debt.balance_cents / 100, 1000);
  const [amount, setAmount] = useState(String(suggest));
  const [paidAt, setPaidAt] = useState(bjToday());
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="rounded-lg bg-elevated/60 px-3 py-2 text-[11px] text-ink-mute tabular-nums">
        当前余额 {fmt(debt.balance_cents)} · 年化 {debt.rate_pct}%{debt.monthly_cents != null ? ` · 月供 ${fmt(debt.monthly_cents)}` : ""}
      </p>
      <div className="flex gap-2">
        <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="还款金额（元）" className={inputCls} />
        <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-40 shrink-0 rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-sky-500" />
      </div>
      <div className="flex gap-2">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls} title="选择后自动记一笔「还款」支出">
          <option value="">不联动记账</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可空）" className={inputCls} />
      </div>
      <p className="text-[10px] text-ink-faint">
        {accountId ? "✓ 将同时在所选账户记一笔「还款」支出流水" : "仅记录还款进度，不生成流水（避免与已有记账重复）"}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
        <button
          disabled={busy || !amount}
          onClick={async () => {
            const cents = Math.round(parseFloat(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0) return;
            setBusy(true);
            try {
              const r = await api(`/api/debts/${debt.id}/payments`, "POST", {
                amountCents: cents,
                paidAt,
                accountId: accountId || null,
                note: note || null,
              });
              const cleared = r.debt?.status === "cleared";
              await onDone(cleared ? `🎉 已还清「${debt.name}」，档案自动标记为已结清` : `✅ 已记还款 ${fmt(cents)}`);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : "确认还款"}
        </button>
      </div>
    </div>
  );
}
