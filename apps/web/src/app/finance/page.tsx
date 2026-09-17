"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/nav";
import BillImport from "@/components/bill-import";
import { TX_CATEGORIES, budgetTone, categoryBreakdown, momChange, savingsRate, yuan } from "@/lib/finance";

interface Account {
  id: string;
  name: string;
  icon: string;
  opening_balance_cents: number;
  balance_cents: number;
}
interface Tx {
  id: string;
  direction: "out" | "in";
  amount_cents: number;
  category: string;
  counterparty: string | null;
  note: string | null;
  occurred_at: string;
  is_draft: boolean;
  source: string;
  entry_id: string | null;
  account_id: string | null;
  account_name: string | null;
  account_icon: string | null;
}
interface Overview {
  month: string;
  outCents: number;
  inCents: number;
  byCategory: Record<string, number>;
  prev: { outCents: number; inCents: number };
  draftCount: number;
  budget: { monthly_limit_cents: number; alert_threshold: number };
  accounts: Account[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const zhDay = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const label = diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${label} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const monthTitle = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
/** 负数放负号在前：-¥260（直接拼接会出现 ¥-260） */
const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);
function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const nowMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "操作失败");
  return j;
}

export default function FinancePage() {
  const [month, setMonth] = useState(nowMonth());
  const [ov, setOv] = useState<Overview | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [managingAccount, setManagingAccount] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [confirming, setConfirming] = useState<Tx | null>(null);
  const [editing, setEditing] = useState<Tx | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const load = useCallback(async () => {
    const [o, t] = await Promise.all([
      fetch(`/api/finance/overview?month=${month}`),
      fetch(`/api/transactions?month=${month}`),
    ]);
    setOv(await o.json());
    setTxs((await t.json()).transactions ?? []);
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const drafts = useMemo(() => txs.filter((t) => t.is_draft), [txs]);
  const confirmed = useMemo(() => txs.filter((t) => !t.is_draft), [txs]);
  const slices = useMemo(() => (ov ? categoryBreakdown(ov.byCategory) : []), [ov]);
  const budget = useMemo(
    () =>
      ov
        ? budgetTone(ov.outCents, ov.budget.monthly_limit_cents, ov.budget.alert_threshold)
        : { tone: "none" as const, pct: 0 },
    [ov],
  );
  const outDelta = ov ? momChange(ov.outCents, ov.prev.outCents) : null;
  const rate = ov ? savingsRate(ov.inCents, ov.outCents) : null;

  async function confirmTx(accountId: string | null) {
    if (!confirming) return;
    try {
      await api(`/api/transactions/${confirming.id}`, "PATCH", { confirm: true, accountId });
      setMsg({ ok: true, text: `✅ 已入账：${confirming.direction === "out" ? "支出" : "收入"} ¥${yuan(confirming.amount_cents)}` });
      setConfirming(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function removeTx(t: Tx) {
    if (!window.confirm(`删除这笔流水？\n${t.direction === "out" ? "支出" : "收入"} ¥${yuan(t.amount_cents)} · ${t.category}`)) return;
    try {
      await api(`/api/transactions/${t.id}`, "DELETE");
      setMsg({ ok: true, text: "🗑 已删除流水" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!ov) {
    return (
      <main className="min-h-screen text-slate-100">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Nav />
          <p className="py-16 text-center text-xs text-slate-500">加载中…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <header className="mb-6 text-center">
          <h1 className="text-gradient text-4xl font-bold tracking-wide">
            拾光复利<span className="ml-2 align-middle text-sm font-normal tracking-normal text-slate-500">财务</span>
          </h1>
          <p className="mt-2 text-xs text-slate-500">动态里说的钱都在这里 —— 确认草稿、管账户、看月度结构</p>
        </header>

        {/* 月份导航 + 记一笔（窄屏自动换行，避免按钮溢出） */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50">‹</button>
            <span className="min-w-24 text-center text-sm font-semibold text-slate-200 tabular-nums">{monthTitle(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50">›</button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button onClick={() => setImporting(true)} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20">
              📥 导入账单
            </button>
            <button onClick={() => setAdding(true)} className="btn-primary whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium">
              ＋ 记一笔
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
              msg.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 草稿提醒 */}
        {drafts.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            📥 有 <span className="font-bold">{drafts.length}</span> 笔动态识别的流水待确认
            <button onClick={() => document.getElementById("draft-area")?.scrollIntoView({ behavior: "smooth" })} className="ml-2 underline underline-offset-2 hover:text-amber-100">
              去确认
            </button>
          </div>
        )}

        {/* 概览卡 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[11px] text-slate-500">本月支出</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-rose-300">¥{yuan(ov.outCents)}</p>
              {outDelta != null && (
                <p className={`mt-0.5 text-[10px] tabular-nums ${outDelta > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  较上月 {outDelta > 0 ? "+" : ""}{outDelta}%
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] text-slate-500">本月收入</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-300">¥{yuan(ov.inCents)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">结余</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${ov.inCents - ov.outCents >= 0 ? "text-sky-300" : "text-rose-300"}`}>
                {fmtMoney(ov.inCents - ov.outCents)}
              </p>
              {rate != null && <p className="mt-0.5 text-[10px] text-slate-500">储蓄率 {rate}%</p>}
            </div>
          </div>

          {/* 预算进度 */}
          <div className="mt-4 border-t border-slate-800 pt-3">
            {editingBudget ? (
              <BudgetEditor
                ov={ov}
                onCancel={() => setEditingBudget(false)}
                onSaved={async () => {
                  setEditingBudget(false);
                  setMsg({ ok: true, text: "💾 月度上限已保存" });
                  await load();
                }}
              />
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">
                    {ov.budget.monthly_limit_cents > 0
                      ? `月度上限 ¥${yuan(ov.budget.monthly_limit_cents)}`
                      : "未设月度上限"}
                  </span>
                  <button onClick={() => setEditingBudget(true)} className="text-slate-500 hover:text-sky-300">
                    {ov.budget.monthly_limit_cents > 0 ? "调整" : "设置"}
                  </button>
                </div>
                {ov.budget.monthly_limit_cents > 0 && (
                  <>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          budget.tone === "over"
                            ? "bg-gradient-to-r from-rose-500 to-rose-400"
                            : budget.tone === "warn"
                              ? "bg-gradient-to-r from-amber-500 to-amber-400"
                              : "bg-gradient-to-r from-sky-500 to-indigo-400"
                        }`}
                        style={{ width: `${Math.min(budget.pct, 100)}%` }}
                      />
                    </div>
                    <p className={`mt-1 text-[10px] tabular-nums ${
                      budget.tone === "over" ? "text-rose-300" : budget.tone === "warn" ? "text-amber-300" : "text-slate-500"
                    }`}>
                      {budget.tone === "over"
                        ? `⚠️ 已超支 ¥${yuan(ov.outCents - ov.budget.monthly_limit_cents)}（${budget.pct}%）`
                        : budget.tone === "warn"
                          ? `⚠️ 已用 ${budget.pct}%，接近上限，注意控制`
                          : `已用 ${budget.pct}%`}
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* 分类占比 */}
          {slices.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                {slices.map((s) => (
                  <div
                    key={s.category}
                    title={`${s.category} ${yuan(s.cents)}（${s.pct}%）`}
                    style={{
                      width: `${s.pct}%`,
                      backgroundColor: TX_COLORS[s.category] ?? "#64748b",
                    }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {slices.slice(0, 6).map((s) => (
                  <span key={s.category} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                    {s.category}
                    <span className="tabular-nums text-slate-500">¥{yuan(s.cents)} · {s.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 账户 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              💳 账户
              <span className="ml-2 text-xs font-normal text-slate-500">
                合计 {fmtMoney(ov.accounts.reduce((s, a) => s + a.balance_cents, 0))}
              </span>
            </h2>
            <button onClick={() => setManagingAccount(true)} className="text-xs text-slate-400 hover:text-sky-300">
              管理
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ov.accounts.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-center">
                <p className="text-lg">{a.icon}</p>
                <p className="truncate text-[11px] text-slate-400">{a.name}</p>
                <p className="text-sm font-semibold tabular-nums text-slate-200">{fmtMoney(a.balance_cents)}</p>
              </div>
            ))}
            {ov.accounts.length === 0 && (
              <p className="col-span-full py-3 text-center text-xs text-slate-600">
                还没有账户 —— 点「管理」添加现金/支付宝等
              </p>
            )}
          </div>
        </section>

        {/* 草稿确认区 */}
        {drafts.length > 0 && (
          <section id="draft-area" className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
            <h2 className="mb-3 text-sm font-semibold text-amber-200">
              📥 待确认流水
              <span className="ml-2 text-xs font-normal text-amber-200/60">来自动态识别 · 确认后计入报表</span>
            </h2>
            <ul className="space-y-2">
              {drafts.map((t) => (
                <li key={t.id} className="rounded-xl border border-amber-500/20 bg-slate-950/50 px-3 py-2.5">
                  {confirming?.id === t.id ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-300">记入账户：</span>
                      {ov.accounts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => confirmTx(a.id)}
                          className="rounded-full bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition hover:bg-sky-600"
                        >
                          {a.icon} {a.name}
                        </button>
                      ))}
                      <button onClick={() => confirmTx(null)} className="rounded-full px-3 py-1 text-[11px] text-slate-400 hover:text-sky-300">
                        不记账户
                      </button>
                      <button onClick={() => setConfirming(null)} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300">
                        取消
                      </button>
                    </div>
                  ) : (
                    <TxRow tx={t} onConfirm={() => setConfirming(t)} onEdit={() => setEditing(t)} onDelete={() => removeTx(t)} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 已确认流水 */}
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            🧾 流水
            <span className="ml-2 text-xs font-normal text-slate-500">{confirmed.length} 笔</span>
          </h2>
          {confirmed.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-600">
              本月还没有流水 —— 说句"打车花了30"，或点「＋ 记一笔」
            </p>
          )}
          <ul className="space-y-1">
            {confirmed.map((t) =>
              editing?.id === t.id ? (
                <li key={t.id} className="rounded-xl border border-sky-500/40 bg-slate-800/60 p-3">
                  <TxForm
                    accounts={ov.accounts}
                    initial={t}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (payload) => {
                      await api(`/api/transactions/${t.id}`, "PATCH", payload);
                      setEditing(null);
                      setMsg({ ok: true, text: "💾 流水已更新" });
                      await load();
                    }}
                  />
                </li>
              ) : (
                <li key={t.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800/60">
                  <TxRow tx={t} onEdit={() => setEditing(t)} onDelete={() => removeTx(t)} />
                </li>
              ),
            )}
          </ul>
        </section>

        {/* 手动记账弹层 */}
        {adding && (
          <Modal title="记一笔" onClose={() => setAdding(false)}>
            <TxForm
              accounts={ov.accounts}
              onCancel={() => setAdding(false)}
              onSubmit={async (payload) => {
                await api("/api/transactions", "POST", payload);
                setAdding(false);
                setMsg({ ok: true, text: "✅ 已记一笔" });
                await load();
              }}
            />
          </Modal>
        )}

        {/* 账单导入弹层 */}
        {importing && (
          <BillImport
            accounts={ov.accounts}
            onClose={() => setImporting(false)}
            onImported={async () => {
              await load();
            }}
          />
        )}

        {/* 账户管理弹层 */}
        {managingAccount && (
          <Modal title="账户管理" onClose={() => setManagingAccount(false)}>
            <AccountManager
              accounts={ov.accounts}
              onChanged={async () => {
                await load();
              }}
            />
          </Modal>
        )}

        <footer className="mt-10 text-center text-[10px] text-slate-600">
          拾光复利 · 财务模块 v1 · 流水确认后计入月度报表
        </footer>
      </div>
    </main>
  );
}

/* ---------- 子组件 ---------- */

const TX_COLORS: Record<string, string> = {
  餐饮: "#f97316",
  交通: "#78716c",
  人情往来: "#ec4899",
  学习: "#10b981",
  购物: "#8b5cf6",
  娱乐: "#eab308",
  医疗: "#14b8a6",
  居住: "#0ea5e9",
  其他: "#64748b",
};

function TxRow({ tx: t, onConfirm, onEdit, onDelete }: { tx: Tx; onConfirm?: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const d = new Date(t.occurred_at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const compactDay = `${sameYear ? "" : `${String(d.getFullYear()).slice(2)}/`}${d.getMonth() + 1}/${d.getDate()}`;
  return (
    <>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${t.direction === "out" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
        {t.direction === "out" ? "支" : "收"}
      </span>
      <span className="w-12 shrink-0 text-[11px] tabular-nums text-slate-500" title={zhDay(t.occurred_at)}>
        {compactDay}
      </span>
      <span className="flex-1 truncate text-sm">
        {t.category}
        {t.counterparty && <span className="text-xs text-slate-500"> · {t.counterparty}</span>}
        {t.note && t.note !== t.category && <span className="text-xs text-slate-500"> · {t.note}</span>}
      </span>
      {t.account_name && <span className="shrink-0 text-[11px] text-slate-500">{t.account_icon} {t.account_name}</span>}
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.direction === "out" ? "text-rose-300" : "text-emerald-300"}`}>
        {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
      </span>
      <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
        {onConfirm && (
          <button onClick={onConfirm} title="确认入账" className="rounded px-1.5 py-0.5 text-xs text-amber-300 hover:bg-slate-700">
            ✓
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} title="修改" className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300">
            ✏️
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="删除" className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300">
            🗑
          </button>
        )}
      </span>
    </>
  );
}

/** 记账/编辑表单（元输入，提交转分） */
function TxForm({
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
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {d === "out" ? "支出" : "收入"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <span className="flex items-center text-lg text-slate-500">¥</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="金额"
          className="w-28 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
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
          className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
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
          className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="对方（可空）"
          title="和谁有关 —— 填了会关联到 TA 的人情账（如：老王）"
          className="w-24 shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <input
          value={note ?? ""}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可空）"
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-slate-400 hover:bg-slate-700">
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

/** 账户管理：新增 + 期初余额 + 归档 */
function AccountManager({ accounts, onChanged }: { accounts: Account[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💳");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const ICONS = ["💵", "🅰", "💬", "💳", "🏦", "📈", "🎓", "🏠"];

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {accounts.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-lg">{a.icon}</span>
            <span className="flex-1 truncate text-sm">{a.name}</span>
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
              className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-sky-500"
            />
            <button
              title="归档账户（历史流水保留）"
              onClick={async () => {
                if (!window.confirm(`归档「${a.name}」？归档后不再显示，历史流水保留。`)) return;
                await api(`/api/accounts/${a.id}`, "DELETE");
                await onChanged();
              }}
              className="row-actions-hidden hidden text-xs text-slate-500 hover:text-rose-300 group-hover:block"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none">
          {ICONS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新账户名（如：招行储蓄卡）"
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
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

/** 预算编辑 */
function BudgetEditor({ ov, onCancel, onSaved }: { ov: Overview; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [limit, setLimit] = useState(ov.budget.monthly_limit_cents > 0 ? String(ov.budget.monthly_limit_cents / 100) : "");
  const [threshold, setThreshold] = useState(ov.budget.alert_threshold);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-400">月度支出上限 ¥</span>
      <input
        autoFocus
        type="number"
        min="0"
        step="1"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="0 = 不设上限"
        className="w-28 rounded border border-slate-600 bg-slate-900 px-2 py-1 tabular-nums outline-none focus:border-sky-500"
      />
      <span className="text-slate-400">预警阈值</span>
      <select
        value={threshold}
        onChange={(e) => setThreshold(Number(e.target.value))}
        className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 outline-none"
      >
        {[50, 60, 70, 80, 90].map((t) => (
          <option key={t} value={t}>{t}%</option>
        ))}
      </select>
      <span className="ml-auto flex gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-slate-400 hover:bg-slate-700">取消</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const cents = limit ? Math.round(parseFloat(limit) * 100) : 0;
              await api("/api/budget", "PUT", { monthlyLimitCents: Number.isFinite(cents) ? cents : 0, alertThreshold: threshold });
              await onSaved();
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded px-4 py-1 font-medium"
        >
          保存
        </button>
      </span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass w-full max-w-md rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <button onClick={onClose} className="rounded px-2 text-slate-500 hover:text-slate-200">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
