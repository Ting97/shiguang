"use client";

import { useEffect, useState } from "react";
import { DEBT_TYPES, DEBT_TYPE_META, yuanToCents, centsToYuanInput, type DebtType } from "@/lib/finance";
import type { Debt, Account } from "./kit";
import { fmt, bjToday, api } from "./kit";
import { useImeSubmit } from "@/lib/use-ime-submit";

// REQ-009 FR-B2：弹层壳统一，全站唯一实现在 ui/modal（同签名 title/onClose/children）
export { Modal } from "@/components/ui/modal";

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-sky-500";

/** busy 上报（二十轮 P2）：提交状态提升给页面层传 <Modal busy>——提交中禁 Esc/点遮罩/× 关闭。
 *  旧版 busy 只在表单内部，弹层在 POST 在途时被关闭：成功 toast 在弹层已关后才弹，
 *  用户以为已取消、重复录入 → 同笔负债双还款余额双扣 */
function useBusyReport(busy: boolean, onBusyChange?: (b: boolean) => void) {
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
}

export function DebtForm({
  initial,
  onCancel,
  onSubmit,
  onBusyChange,
}: {
  initial: Debt | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onBusyChange?: (b: boolean) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<DebtType>(initial?.type ?? "credit_card");
  const [principal, setPrincipal] = useState(initial ? centsToYuanInput(initial.principal_cents) : "");
  const [balance, setBalance] = useState(initial ? centsToYuanInput(initial.balance_cents) : "");
  const [rate, setRate] = useState(initial ? String(initial.rate_pct) : "");
  const [monthly, setMonthly] = useState(initial?.monthly_cents != null ? centsToYuanInput(initial.monthly_cents) : "");
  const [payDay, setPayDay] = useState(initial?.pay_day ? String(initial.pay_day) : "");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [priority, setPriority] = useState(initial ? String(initial.priority) : "0");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  // 提交失败就地提示（历史 bug：try/finally 无 catch，失败静默 + unhandled rejection 触发整页刷新清空表单）
  const [err, setErr] = useState<string | null>(null);
  useBusyReport(busy, onBusyChange);

  /** 保存：按钮 submit 与表单 Enter 提交共用，守卫防双触发 */
  async function save() {
    if (busy || !name.trim() || !principal) return;
    setBusy(true);
    setErr(null);
    try {
      // 金额解析统一走 yuanToCents：非法输入返回 null，就地提示（原 parseFloat NaN 版静默按 0 入账）。
      // 本地钳制收口（二十轮 P3）：null（格式非法或超 ¥100 万）/负数/0 分开报错，利率/优先级就地钳制——
      // 旧版全靠服务端 400 兜底且「超限」统一报「金额格式不正确」误导排查
      const overLimit = (raw: string) => {
        const n = Number(raw.replace(/[¥￥,\s]/g, ""));
        return Number.isFinite(n) && n > 1_000_000;
      };
      const principalCents = yuanToCents(principal);
      if (principalCents == null) {
        setErr(overLimit(principal) ? "单笔金额不能超过 ¥100 万" : "金额格式不正确");
        return;
      }
      if (principalCents <= 0) {
        setErr(principalCents < 0 ? "本金不能为负数" : "本金需为大于 0 的金额");
        return;
      }
      const balanceCents = balance ? yuanToCents(balance) : null;
      if (balance && balanceCents == null) {
        setErr(overLimit(balance) ? "单笔金额不能超过 ¥100 万" : "金额格式不正确");
        return;
      }
      const monthlyCents = monthly ? yuanToCents(monthly) : null;
      if (monthly && monthlyCents == null) {
        setErr(overLimit(monthly) ? "单笔金额不能超过 ¥100 万" : "金额格式不正确");
        return;
      }
      const rateNum = Number.isFinite(parseFloat(rate)) ? parseFloat(rate) : 0;
      if (rateNum < 0 || rateNum > 36) {
        setErr("年化利率需在 0~36 之间");
        return;
      }
      const priorityNum = Number.isFinite(Number(priority)) ? Math.round(Number(priority)) : 0;
      if (priorityNum < 0 || priorityNum > 99) {
        setErr("优先级需在 0~99 之间（数字越小越优先）");
        return;
      }
      await onSubmit({
        name: name.trim(),
        type,
        principalCents,
        ...(balance ? { balanceCents } : {}),
        ratePct: rateNum,
        monthlyCents: monthly ? monthlyCents : null,
        payDay: payDay ? Math.min(31, Math.max(1, Number(payDay))) : null, // 还款日钳 1~31（输入框 min/max 不拦手输越界值）
        dueDate: dueDate || null,
        priority: priorityNum,
        note: note || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ime = useImeSubmit(save);
  return (
    <form
      className="space-y-2.5"
      onSubmit={ime.onSubmit}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
    >
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（如：招行信用卡）" maxLength={40} className={inputCls} />
        <select value={type} onChange={(e) => setType(e.target.value as DebtType)} className="w-32 shrink-0 rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm outline-none focus:border-sky-500">
          {DEBT_TYPES.map((t) => (
            <option key={t} value={t}>{DEBT_TYPE_META[t].icon} {DEBT_TYPE_META[t].label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-micro text-ink-mute">
          本金（元）
          <input type="number" min="0" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="原始本金" className={inputCls} />
        </label>
        <label className="text-micro text-ink-mute">
          当前余额（元）
          <input type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="默认=本金" className={inputCls} />
        </label>
        <label className="text-micro text-ink-mute">
          年化利率 %
          <input type="number" min="0" max="36" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0~36" className={inputCls} />
        </label>
        <label className="text-micro text-ink-mute">
          月供（元，亲友可空）
          <input type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="可空" className={inputCls} />
        </label>
        <label className="text-micro text-ink-mute">
          每月还款日
          <input type="number" min="1" max="31" value={payDay} onChange={(e) => setPayDay(e.target.value)} placeholder="1~31 可空" className={inputCls} />
        </label>
        <label className="text-micro text-ink-mute">
          到期/结清日
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex items-center gap-1.5 text-micro text-ink-mute">
          优先级
          <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} title="数字越小越优先" className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可空）" className={inputCls} />
      </div>
      {err && <p className="text-micro text-danger">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
        <button
          type="submit"
          disabled={busy || !name.trim() || !principal}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : initial ? "保存" : "建档"}
        </button>
      </div>
    </form>
  );
}

export function PaymentForm({
  debt,
  accounts,
  onCancel,
  onDone,
  onError,
  onBusyChange,
}: {
  debt: Debt;
  accounts: Account[];
  onCancel: () => void;
  onDone: (text: string) => Promise<void>;
  onError: (text: string) => void;
  onBusyChange?: (b: boolean) => void;
}) {
  // 建议还款额在分域算好再转元串（centsToYuanInput 整数商余，浮点 /100 会出长小数——十四轮 P2 收口）
  const suggestCents = debt.monthly_cents ?? Math.min(debt.balance_cents, 100_000);
  const [amount, setAmount] = useState(centsToYuanInput(suggestCents));
  const [paidAt, setPaidAt] = useState(bjToday());
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useBusyReport(busy, onBusyChange);

  /** 确认还款：按钮 submit 与表单 Enter 提交共用，守卫防双触发 */
  async function save() {
    if (busy || !amount) return;
    const cents = yuanToCents(amount);
    if (cents == null || cents <= 0) {
      onError("金额需大于 0"); // 0/负数/非法输入静默早退会让人以为已还款
      return;
    }
    // 超额预检（二十轮，服务端同口径 400）：溢出部分旧版被静默丢弃、联动流水却全额记支出
    if (cents > debt.balance_cents) {
      onError(`还款金额超过剩余本金 ${fmt(debt.balance_cents)}，结清请按剩余本金金额记录`);
      return;
    }
    const todayBj = bjToday();
    if (paidAt > todayBj) {
      onError("还款日期不能晚于今天");
      return;
    }
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
  }

  const ime = useImeSubmit(save);
  return (
    <form
      className="space-y-2.5"
      onSubmit={ime.onSubmit}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
    >
      <p className="rounded-lg bg-elevated/60 px-3 py-2 text-micro text-ink-mute tabular-nums">
        当前余额 {fmt(debt.balance_cents)} · 年化 {debt.rate_pct}%{debt.monthly_cents != null ? ` · 月供 ${fmt(debt.monthly_cents)}` : ""}
      </p>
      <div className="flex gap-2">
        <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="还款金额（元）" className={inputCls} />
        {/* max=今天（二十轮）：未来还款无业务语义，前端先拦少一次往返 */}
        <input type="date" max={bjToday()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-40 shrink-0 rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-sky-500" />
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
      <p className="text-badge text-ink-faint">
        {accountId ? "✓ 将同时在所选账户记一笔「还款」支出流水" : "仅记录还款进度，不生成流水（避免与已有记账重复）"}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
        <button
          type="submit"
          disabled={busy || !amount || Number(amount) <= 0}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : "确认还款"}
        </button>
      </div>
    </form>
  );
}
