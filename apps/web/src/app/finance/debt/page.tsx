"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/nav";
import Skeleton from "@/components/skeleton";
import FinanceTabs from "@/components/finance-tabs";
import ModuleLocked from "@/components/module-locked";
import { TagChip } from "@/components/tag-chip";
import { useDismiss } from "@/components/dismissable";
import { DEBT_TYPES, DEBT_TYPE_META, type DebtType, yuan } from "@/lib/finance";

/**
 * 负债管理（REQ-003 3-F FR-C2.2 ~ FR-C2.6）
 * 总览卡区 → 到期墙 → 档案列表（行内 CRUD）→ 策略模拟 → 还款进度（余额曲线）。
 * 金额一律分存储、元输入；策略模拟为简化模型（月复利/固定月供/固定额外还款），仅供参考。
 */

interface Debt {
  id: string;
  name: string;
  type: DebtType;
  principal_cents: number;
  balance_cents: number;
  rate_pct: number;
  monthly_cents: number | null;
  pay_day: number | null;
  due_date: string | null;
  priority: number;
  note: string | null;
  status: "active" | "cleared" | "archived";
  paid_cents?: number;
  payments_count?: number;
}
interface Wall {
  id: string;
  name: string;
  type: DebtType;
  dueDate: string;
  balanceCents: number;
  monthlyCents: number | null;
  daysLeft: number;
  level: "danger" | "warn";
}
interface Overview {
  totals: { balanceCents: number; bankCents: number; monthlyDueCents: number; weightedRatePct: number; liabilityCount: number };
  netWorthCents: number;
  assetBalanceCents: number;
  wall: Wall[];
  cashFlow: {
    monthKey: string;
    incomeCents: number;
    expenseCents: number;
    realizedCents: number;
    paidThisMonthCents: number;
    remainingDueCents: number;
    gapCents: number;
  };
  hints: string[];
}
interface Account { id: string; name: string; icon: string; balance_cents: number }
interface SimPack {
  strategy: string;
  order: string[];
  months: number | null;
  clearedLabel: string | null;
  totalInterestCents: number;
  totalPaidCents: number;
  interestSavedVsBaselineCents: number;
  monthsSavedVsBaseline: number | null;
  schedule: { month: string; paidCents: number; interestCents: number; balanceCents: number }[];
  notCleared: boolean;
}
interface SimResult { baseline: SimPack; snowball: SimPack; avalanche: SimPack; startMonth: string }

const fmt = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

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

export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Debt | null | "new">(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const [extra, setExtra] = useState(100000); // 每月额外还款（分），默认 ¥1000
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const load = useCallback(async () => {
    const [d, o, a] = await Promise.all([
      fetch("/api/debts"),
      fetch("/api/debts/overview"),
      fetch("/api/accounts"),
    ]);
    if (d.status === 403 || o.status === 403) {
      setLocked(true);
      setDebts([]);
      return;
    }
    setDebts((await d.json()).debts ?? []);
    setOv(await o.json());
    if (a.ok) setAccounts((await a.json()).accounts ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => (debts ?? []).filter((d) => d.status === "active"), [debts]);
  const settled = useMemo(() => (debts ?? []).filter((d) => d.status !== "active"), [debts]);

  async function runSim(extraCents: number) {
    setSimBusy(true);
    try {
      const r = await api("/api/debts/simulate", "POST", { extraMonthlyCents: extraCents });
      setSim(r as SimResult);
    } catch (e) {
      setSim(null);
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSimBusy(false);
    }
  }

  if (locked) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <Nav />
          <ModuleLocked title="负债管理" desc="该模块由管理员授权后开放，可联系管理员开通。" />
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
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">负债管理</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">档案、还款、到期墙与清债策略 —— 看得清，还得动</p>
        </header>

        <FinanceTabs />

        {msg && <div className={`msg-banner mb-4 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>}

        {!debts || !ov ? (
          <Skeleton rows={4} className="py-2" />
        ) : (
          <>
            {/* 总览卡区 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                <div>
                  <p className="text-[11px] text-ink-dim">总负债（含亲友）</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-danger">{fmt(ov.totals.balanceCents)}</p>
                  {ov.totals.bankCents !== ov.totals.balanceCents && (
                    <p className="mt-0.5 text-[10px] text-ink-faint tabular-nums">银行口径 {fmt(ov.totals.bankCents)}</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-ink-dim">月供合计</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-ink">{fmt(ov.totals.monthlyDueCents)}</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">{ov.totals.liabilityCount} 笔进行中</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-dim">加权利率</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-warn">{ov.totals.weightedRatePct}%</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">按余额加权</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-dim">净资产</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums ${ov.netWorthCents >= 0 ? "text-success" : "text-danger"}`}>
                    {fmt(ov.netWorthCents)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-faint tabular-nums">资产 {fmt(ov.assetBalanceCents)} − 负债</p>
                </div>
              </div>

              {/* 现金流月视图 */}
              <div className="mt-4 border-t border-line-soft pt-3 text-[11px] text-ink-mute">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span>
                    {ov.cashFlow.monthKey.slice(0, 4)}年{Number(ov.cashFlow.monthKey.slice(5))}月结余
                    <span className={`ml-1.5 font-semibold tabular-nums ${ov.cashFlow.realizedCents >= 0 ? "text-success" : "text-danger"}`}>
                      {fmt(ov.cashFlow.realizedCents)}
                    </span>
                    <span className="ml-2 text-ink-faint">收入 {fmt(ov.cashFlow.incomeCents)} · 支出 {fmt(ov.cashFlow.expenseCents)}</span>
                  </span>
                  <span>
                    剩余月供
                    <span className="ml-1.5 font-semibold tabular-nums text-warn">{fmt(ov.cashFlow.remainingDueCents)}</span>
                    <span className={`ml-2 font-semibold ${ov.cashFlow.gapCents >= 0 ? "text-success" : "text-danger"}`}>
                      {ov.cashFlow.gapCents >= 0 ? "盈余 " : "缺口 "}{fmt(Math.abs(ov.cashFlow.gapCents))}
                    </span>
                  </span>
                </div>
              </div>

              {ov.hints.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line-soft pt-3">
                  {ov.hints.map((h, i) => (
                    <li key={i} className="text-[11px] text-warn">💡 {h}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* 到期墙 */}
            {ov.wall.length > 0 && (
              <section className="mb-4 rounded-2xl border border-line-soft bg-surface/50 p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
                  <TagChip icon="⏳" label="到期墙" tone="amber" />
                  <span className="text-xs font-normal text-ink-dim">未来 6 个月内到期</span>
                </h2>
                <ul className="space-y-2">
                  {ov.wall.map((w) => (
                    <li
                      key={w.id}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-xs ${
                        w.level === "danger" ? "border-rose-500/30 bg-rose-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.06]"
                      }`}
                    >
                      <span>{DEBT_TYPE_META[w.type]?.icon}</span>
                      <span className="font-medium text-ink">{w.name}</span>
                      <span className={w.level === "danger" ? "text-danger" : "text-warn"}>
                        {w.dueDate.slice(0, 10)} 到期
                        <span className="ml-1.5">剩 {w.daysLeft} 天</span>
                      </span>
                      <span className="ml-auto font-semibold tabular-nums text-ink">{fmt(w.balanceCents)}</span>
                      {w.monthlyCents === 0 && <span className="text-[10px] text-ink-faint">无月供 · 到期一次结清</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 档案列表 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
                  <TagChip icon="🏦" label="负债档案" tone="rose" />
                  <span className="text-xs font-normal text-ink-dim">{active.length} 笔进行中</span>
                </h2>
                <button onClick={() => setEditing("new")} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20">
                  ＋ 新建档案
                </button>
              </div>

              {active.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-faint">
                  还没有负债档案 —— 点「＋ 新建档案」录入第一笔
                </p>
              )}
              <ul className="space-y-2">
                {active.map((d) => (
                  <li key={d.id} className="force-actions group rounded-xl border border-line-soft bg-bg/40 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-lg">{DEBT_TYPE_META[d.type]?.icon ?? "💳"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {d.name}
                        <span className="ml-1.5 text-[10px] text-ink-faint">{DEBT_TYPE_META[d.type]?.label}</span>
                        {d.priority > 0 && <span className="ml-1.5 rounded bg-rose-500/15 px-1 text-[10px] text-danger">P{d.priority}</span>}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-danger">{fmt(d.balance_cents)}</span>
                      <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
                        <button onClick={() => setPaying(d)} title="记还款" className="rounded px-1.5 py-0.5 text-xs text-success hover:bg-soft">💰</button>
                        <button onClick={() => setEditing(d)} title="编辑" className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent">✏️</button>
                        <button
                          title="归档"
                          onClick={async () => {
                            if (!window.confirm(`归档「${d.name}」？归档后不再统计，可随时恢复。`)) return;
                            try {
                              await api(`/api/debts/${d.id}`, "DELETE");
                              setMsg({ ok: true, text: "📦 已归档" });
                              await load();
                            } catch (e) {
                              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                            }
                          }}
                          className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger"
                        >
                          🗑
                        </button>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-dim">
                      <span className="tabular-nums">年化 {d.rate_pct}%</span>
                      {d.monthly_cents != null && <span className="tabular-nums">月供 {fmt(d.monthly_cents)}</span>}
                      {d.pay_day != null && <span>每月 {d.pay_day} 日</span>}
                      {d.due_date && <span>{d.due_date} 到期</span>}
                    </div>
                    {/* 进度条：已还本金占比 */}
                    {d.principal_cents > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((d.principal_cents - d.balance_cents) / d.principal_cents) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-ink-faint tabular-nums">
                          已还 {fmt(d.principal_cents - d.balance_cents)} / 本金 {fmt(d.principal_cents)}
                          {d.paid_cents != null && d.paid_cents > 0 && ` · 累计还款 ${fmt(d.paid_cents)}（${d.payments_count} 笔）`}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {settled.length > 0 && (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <button onClick={() => setShowCleared((v) => !v)} className="text-xs text-ink-mute hover:text-accent">
                    {showCleared ? "▾" : "▸"} 已结清 / 已归档（{settled.length}）
                  </button>
                  {showCleared && (
                    <ul className="mt-2 space-y-1.5">
                      {settled.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-xs text-ink-mute">
                          <span>{DEBT_TYPE_META[d.type]?.icon}</span>
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                          <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px]">{d.status === "cleared" ? "已结清" : "已归档"}</span>
                          <span className="tabular-nums">{fmt(d.balance_cents)}</span>
                          {d.status === "archived" && (
                            <button
                              onClick={async () => {
                                await api(`/api/debts/${d.id}`, "PATCH", { status: "active" });
                                await load();
                              }}
                              className="text-[10px] text-ink-faint hover:text-accent"
                            >
                              恢复
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* 策略模拟 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
                <TagChip icon="🎯" label="清债策略模拟" tone="violet" />
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-mute">
                <span>每月额外还款</span>
                <input
                  type="range"
                  min={0}
                  max={500000}
                  step={10000}
                  value={extra}
                  onChange={(e) => setExtra(Number(e.target.value))}
                  onPointerUp={() => void runSim(extra)}
                  onKeyUp={() => void runSim(extra)}
                  className="min-w-40 flex-1 accent-sky-500"
                />
                <span className="w-20 text-right font-semibold tabular-nums text-ink">¥{yuan(extra)}</span>
                <button
                  onClick={() => void runSim(extra)}
                  disabled={simBusy}
                  className="btn-primary rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
                >
                  {simBusy ? "推演中…" : "开始模拟"}
                </button>
              </div>
              {sim && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[sim.snowball, sim.avalanche].map((p) => (
                    <div key={p.strategy} className="rounded-xl border border-line-soft bg-bg/40 p-3">
                      <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink">
                        {p.strategy === "snowball" ? "❄️ 雪球（先清小额）" : "🏔️ 雪崩（先清高息）"}
                        <span className="font-normal text-[10px] text-ink-faint">省 {fmt(p.interestSavedVsBaselineCents)} 利息</span>
                      </p>
                      <p className="text-[11px] text-ink-mute tabular-nums">
                        {p.notCleared
                          ? "按当前月供 + 额外还款额无法在 50 年内清零，请提高还款额"
                          : `预计 ${p.clearedLabel} 清零（${p.months} 个月${p.monthsSavedVsBaseline ? `，提前 ${p.monthsSavedVsBaseline} 个月` : ""}）`}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-mute tabular-nums">总利息 {fmt(p.totalInterestCents)}</p>
                      <p className="mt-1 text-[10px] text-ink-faint">清偿顺序：{p.order.join(" → ")}</p>
                    </div>
                  ))}
                  <p className="col-span-full text-right text-[10px] text-ink-faint">
                    基线（仅最低月供）总利息 {fmt(sim.baseline.totalInterestCents)} · 模拟估算，仅供参考
                  </p>
                </div>
              )}
            </section>

            <footer className="mt-10 text-center text-[10px] text-ink-faint">拾光 · 负债管理 · 还款后余额自动递减</footer>
          </>
        )}
      </div>

      {/* 新建/编辑档案弹层 */}
      {editing && (
        <Modal title={editing === "new" ? "新建负债档案" : "编辑负债档案"} onClose={() => setEditing(null)}>
          <DebtForm
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              if (editing === "new") await api("/api/debts", "POST", payload);
              else await api(`/api/debts/${editing.id}`, "PATCH", payload);
              setEditing(null);
              setMsg({ ok: true, text: editing === "new" ? "✅ 已建档" : "💾 已保存" });
              await load();
            }}
          />
        </Modal>
      )}

      {/* 还款弹层 */}
      {paying && (
        <Modal title={`还款 · ${paying.name}`} onClose={() => setPaying(null)}>
          <PaymentForm
            debt={paying}
            accounts={accounts}
            onCancel={() => setPaying(null)}
            onDone={async (text) => {
              setPaying(null);
              setMsg({ ok: true, text });
              await load();
              setSim(null);
            }}
            onError={(text) => setMsg({ ok: false, text })}
          />
        </Modal>
      )}
    </main>
  );
}

/** 余额曲线 sparkline：本金 → 逐笔还款后的余额（最近 12 个点） */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function DebtForm({
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
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
        <button
          disabled={busy || !name.trim() || !principal}
          onClick={async () => {
            setBusy(true);
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

function PaymentForm({
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
