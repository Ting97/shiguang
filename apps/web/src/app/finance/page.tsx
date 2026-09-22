"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/nav";
import Skeleton from "@/components/skeleton";
import BillImport from "@/components/bill-import";
import { TagChip } from "@/components/tag-chip";
import { useDismiss, Dismissable } from "@/components/dismissable";
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
  trend: { month: string; outCents: number; inCents: number; rate: number | null }[];
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
        <header className="mb-6 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">财务</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">动态里说的钱都在这里 —— 确认草稿、管账户、看月度结构</p>
        </header>

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
      {/* 上行：徽章 + 分类/对方/备注 + 金额；窄屏自动折行后下行是 日期+账户+操作 */}
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${t.direction === "out" ? "bg-rose-500/15 text-danger" : "bg-emerald-500/15 text-success"}`}>
        {t.direction === "out" ? "支" : "收"}
      </span>
      <span className="w-12 shrink-0 text-[11px] tabular-nums text-ink-dim" title={zhDay(t.occurred_at)}>
        {compactDay}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {t.category}
        {t.counterparty && <span className="text-xs text-ink-dim"> · {t.counterparty}</span>}
        {t.note && t.note !== t.category && <span className="text-xs text-ink-dim"> · {t.note}</span>}
      </span>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.direction === "out" ? "text-danger" : "text-success"}`}>
        {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
      </span>
      {t.account_name && (
        <span className="row-secondary hidden shrink-0 items-center gap-1 text-[11px] text-ink-dim sm:flex">
          {t.account_icon} {t.account_name}
        </span>
      )}
      <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
        {onConfirm && (
          <button onClick={onConfirm} title="确认入账" className="rounded px-1.5 py-0.5 text-xs text-warn hover:bg-soft">
            ✓
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} title="修改" className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent">
            ✏️
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="删除" className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger">
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
function AccountManager({ accounts, onChanged }: { accounts: Account[]; onChanged: () => Promise<void> }) {
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

/** 储蓄率趋势（近 6 个月小柱图）：rate=null 表示当月无收入无法计算 */
function SavingsTrend({ trend }: { trend: Overview["trend"] }) {
  const max = Math.max(100, ...trend.map((t) => Math.abs(t.rate ?? 0)));
  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-mute">
        <TagChip icon="📈" label="储蓄率 · 近 6 个月" tone="emerald" />
      </p>
      <div className="flex items-end justify-between gap-2">
        {trend.map((t, i) => {
          const isCur = i === trend.length - 1;
          const h = t.rate == null ? 4 : Math.max(6, (Math.abs(t.rate) / max) * 64);
          return (
            <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span
                className={`text-[10px] tabular-nums ${
                  t.rate == null ? "text-ink-faint" : t.rate >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {t.rate == null ? "—" : `${t.rate}%`}
              </span>
              <div
                title={`${t.month}：收入 ¥${yuan(t.inCents)} · 支出 ¥${yuan(t.outCents)}`}
                className={`w-full rounded-t transition-colors ${
                  t.rate == null
                    ? "bg-elevated"
                    : t.rate >= 0
                      ? "bg-gradient-to-t from-emerald-600/50 to-emerald-400/80"
                      : "bg-gradient-to-t from-rose-600/50 to-rose-400/80"
                } ${isCur ? "ring-1 ring-sky-400/60" : ""}`}
                style={{ height: h }}
              />
              <span className={`text-[9px] tabular-nums ${isCur ? "text-ink-soft" : "text-ink-faint"}`}>
                {Number(t.month.slice(5))}月
              </span>
            </div>
          );
        })}
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
      <span className="text-ink-mute">月度支出上限 ¥</span>
      <input
        autoFocus
        type="number"
        min="0"
        step="1"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="0 = 不设上限"
        className="w-28 rounded border border-line-strong bg-surface px-2 py-1 tabular-nums outline-none focus:border-sky-500"
      />
      <span className="text-ink-mute">预警阈值</span>
      <select
        value={threshold}
        onChange={(e) => setThreshold(Number(e.target.value))}
        className="rounded border border-line-strong bg-surface px-1.5 py-1 outline-none"
      >
        {[50, 60, 70, 80, 90].map((t) => (
          <option key={t} value={t}>{t}%</option>
        ))}
      </select>
      <span className="ml-auto flex gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-ink-mute hover:bg-soft">取消</button>
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
  // N3：点遮罩/空白关闭由面板 useDismiss 统一处理（遮罩保留视觉）
  const ref = useDismiss<HTMLDivElement>(onClose);
  return (
    /* 移动端底部弹层（键盘不遮提交钮、拇指可达）；桌面居中卡片 */
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={ref}
        className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-dim hover:text-ink">✕</button>
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
