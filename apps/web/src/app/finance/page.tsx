"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/nav";
import Skeleton from "@/components/skeleton";
import BillImport from "@/components/bill-import";
import FinanceTabs from "@/components/finance-tabs";
import { TagChip } from "@/components/tag-chip";
import { Dismissable } from "@/components/dismissable";
import { TX_COLORS, budgetTone, categoryBreakdown, momChange, savingsRate, yuan } from "@/lib/finance";

import {
  type Tx,
  type Overview,
  api,
  monthTitle,
  fmtMoney,
  shiftMonth,
  nowMonth,
} from "../../components/finance/kit";
import { TxForm, AccountManager } from "../../components/finance/forms";
import { TxRow, SavingsTrend, BudgetEditor, Modal } from "../../components/finance/display";

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
  const [confirmAll, setConfirmAll] = useState(false);
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

  /** 一键全部入账：所有待确认流水记入同一账户（或都不记） */
  async function confirmAllTx(accountId: string | null) {
    if (drafts.length === 0) return;
    try {
      await Promise.all(drafts.map((t) => api(`/api/transactions/${t.id}`, "PATCH", { confirm: true, accountId })));
      setConfirmAll(false);
      setMsg({ ok: true, text: `✅ 已全部入账（${drafts.length} 笔）` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      await load();
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
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Nav />
          <Skeleton rows={3} className="py-2" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">财务</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">动态里说的钱都在这里 —— 确认草稿、管账户、看月度结构</p>
        </header>

        <FinanceTabs />

        {/* 月份导航 + 记一笔（窄屏自动换行，避免按钮溢出） */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50">‹</button>
            <span className="min-w-24 text-center text-sm font-semibold text-ink tabular-nums">{monthTitle(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-sm transition hover:border-sky-500/50">›</button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button onClick={() => setImporting(true)} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-sky-500/20">
              📥 导入账单
            </button>
            <button onClick={() => setAdding(true)} className="btn-primary whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium">
              ＋ 记一笔
            </button>
          </div>
        </div>

        {msg && <div className={`msg-banner mb-4 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>}

        {/* 草稿提醒 */}
        {drafts.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-warn">
            📥 有 <span className="font-bold">{drafts.length}</span> 笔动态识别的流水待确认
            <button onClick={() => document.getElementById("draft-area")?.scrollIntoView({ behavior: "smooth" })} className="ml-2 underline underline-offset-2 hover:text-warn">
              去确认
            </button>
          </div>
        )}

        {/* 概览卡 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[11px] text-ink-dim">本月支出</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-danger">¥{yuan(ov.outCents)}</p>
              {outDelta != null && (
                <p className={`mt-0.5 text-[10px] tabular-nums ${outDelta > 0 ? "text-danger" : "text-success"}`}>
                  较上月 {outDelta > 0 ? "+" : ""}{outDelta}%
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] text-ink-dim">本月收入</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-success">¥{yuan(ov.inCents)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-dim">结余</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${ov.inCents - ov.outCents >= 0 ? "text-accent" : "text-danger"}`}>
                {fmtMoney(ov.inCents - ov.outCents)}
              </p>
              {rate != null && <p className="mt-0.5 text-[10px] text-ink-dim">储蓄率 {rate}%</p>}
            </div>
          </div>

          {/* 储蓄率趋势（近 6 个月） */}
          <SavingsTrend trend={ov.trend} />

          {/* 预算进度 */}
          <div className="mt-4 border-t border-line-soft pt-3">
            {editingBudget ? (
              <Dismissable onClose={() => setEditingBudget(false)}>
                <BudgetEditor
                  ov={ov}
                  onCancel={() => setEditingBudget(false)}
                  onSaved={async () => {
                    setEditingBudget(false);
                    setMsg({ ok: true, text: "💾 月度上限已保存" });
                    await load();
                  }}
                />
              </Dismissable>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-mute">
                    {ov.budget.monthly_limit_cents > 0
                      ? `月度上限 ¥${yuan(ov.budget.monthly_limit_cents)}`
                      : "未设月度上限"}
                  </span>
                  <button onClick={() => setEditingBudget(true)} className="text-ink-dim hover:text-accent">
                    {ov.budget.monthly_limit_cents > 0 ? "调整" : "设置"}
                  </button>
                </div>
                {ov.budget.monthly_limit_cents > 0 && (
                  <>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-elevated">
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
                      budget.tone === "over" ? "text-danger" : budget.tone === "warn" ? "text-warn" : "text-ink-dim"
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
            <div className="mt-4 border-t border-line-soft pt-3">
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
                  <span key={s.category} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                    {s.category}
                    <span className="tabular-nums text-ink-dim">¥{yuan(s.cents)} · {s.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 账户 */}
        <section className="glass mb-4 rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
              <TagChip icon="💳" label="账户" tone="sky" />
              <span className="text-xs font-normal text-ink-dim">
                合计 {fmtMoney(ov.accounts.reduce((s, a) => s + a.balance_cents, 0))}
              </span>
            </h2>
            <button onClick={() => setManagingAccount(true)} className="text-xs text-ink-mute hover:text-accent">
              管理
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ov.accounts.map((a) => (
              <div key={a.id} className="rounded-xl border border-line-soft bg-bg/40 px-3 py-2.5 text-center">
                <p className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-base leading-none">{a.icon}</p>
                <p className="truncate text-[11px] text-ink-mute">{a.name}</p>
                {a.balance_cents < 0 ? (
                  <p className="text-sm font-semibold tabular-nums text-danger" title="余额为负——流水大于期初，点「管理」调整期初余额">
                    {fmtMoney(a.balance_cents)} ⚠
                  </p>
                ) : (
                  <p className="text-sm font-semibold tabular-nums text-ink">{fmtMoney(a.balance_cents)}</p>
                )}
              </div>
            ))}
            {ov.accounts.length === 0 && (
              <p className="col-span-full py-3 text-center text-xs text-ink-faint">
                还没有账户 —— 点「管理」添加现金/支付宝等
              </p>
            )}
          </div>
        </section>

        {/* 草稿确认区 */}
        {drafts.length > 0 && (
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
                {ov.accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => confirmAllTx(a.id)}
                    className="rounded-full bg-elevated px-3 py-1 text-[11px] text-ink transition hover:bg-sky-600"
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
                <button onClick={() => confirmAllTx(null)} className="rounded-full px-3 py-1 text-[11px] text-ink-mute hover:text-accent">
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
                      {ov.accounts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => confirmTx(a.id)}
                          className="rounded-full bg-elevated px-3 py-1 text-[11px] text-ink transition hover:bg-sky-600"
                        >
                          {a.icon} {a.name}
                        </button>
                      ))}
                      <button onClick={() => confirmTx(null)} className="rounded-full px-3 py-1 text-[11px] text-ink-mute hover:text-accent">
                        不记账户
                      </button>
                      <button onClick={() => setConfirming(null)} className="ml-auto text-[11px] text-ink-dim hover:text-ink-soft">
                        取消
                      </button>
                    </Dismissable>
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
          <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
            <TagChip icon="🧾" label="流水" tone="slate" />
            <span className="text-xs font-normal text-ink-dim">{confirmed.length} 笔</span>
          </h2>
          {confirmed.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-faint">
              本月还没有流水 —— 说句"打车花了30"，或点「＋ 记一笔」
            </p>
          )}
          <ul className="space-y-1">
            {confirmed.map((t) =>
              editing?.id === t.id ? (
                <li key={t.id} className="rounded-xl border border-sky-500/40 bg-elevated/60 p-3">
                  <Dismissable onClose={() => setEditing(null)}>
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
                  </Dismissable>
                </li>
              ) : (
                <li key={t.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 hover:bg-elevated/60">
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

        <footer className="mt-10 text-center text-[10px] text-ink-faint">
          拾光 · 财务模块 v1 · 流水确认后计入月度报表
        </footer>
      </div>
    </main>
  );
}
