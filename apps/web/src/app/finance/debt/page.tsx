"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import Skeleton from "@/components/skeleton";
import FinanceTabs from "@/components/finance-tabs";
import ModuleLocked from "@/components/module-locked";
import { TagChip } from "@/components/tag-chip";
import { DEBT_TYPE_META, yuan } from "@/lib/finance";

/**
 * 负债管理（REQ-003 3-F FR-C2.2 ~ FR-C2.6）
 * 总览卡区 → 到期墙 → 档案列表（行内 CRUD）→ 策略模拟 → 还款进度（余额曲线）。
 * 金额一律分存储、元输入；策略模拟为简化模型（月复利/固定月供/固定额外还款），仅供参考。
 */

import { fmt } from "../../../components/debt/kit";
import ReserveSection from "../../../components/debt/reserve-section";
import DebtImportDrawer from "../../../components/debt/import-drawer";
import { api, ApiClientError } from "@/shared/api";
import type { Debt, Overview, Account, SimResult } from "../../../components/debt/kit";
import { Modal, DebtForm, PaymentForm } from "../../../components/debt/forms";
export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [locked, setLocked] = useState(false);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 归档两步确认（全站规范，替代原生 confirm）
  const armArchive = useArmConfirm();
  const [editing, setEditing] = useState<Debt | null | "new">(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const [extra, setExtra] = useState(100000); // 每月额外还款（分），默认 ¥1000
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [importing, setImporting] = useState(false); // REQ-005 R2 导入抽屉

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const [d, o] = await Promise.all([
        api<{ debts?: Debt[] }>("/api/debts"),
        api<Overview>("/api/debts/overview"),
      ]);
      setDebts(d.debts ?? []);
      setOv(o);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403) {
        setLocked(true);
        setDebts([]);
        return;
      }
      // 非 403 的失败不停在骨架屏（历史 bug：throw 造成 unhandled rejection + 永久加载中）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
    // 账户列表仅供还款选账（原 if (a.ok)）：失败不阻塞负债页主数据
    try {
      const a = await api<{ accounts?: Account[] }>("/api/accounts");
      setAccounts(a.accounts ?? []);
    } catch {
      /* 同原 a.ok === false：忽略 */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => (debts ?? []).filter((d) => d.status === "active"), [debts]);
  const settled = useMemo(() => (debts ?? []).filter((d) => d.status !== "active"), [debts]);

  async function runSim(extraCents: number) {
    if (simBusy) return; // 推演进行中忽略再次触发：滑杆连放会并发乱序，慢的旧响应可能覆盖新结果
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
          <ModuleLocked title="负债管理" desc="该模块由管理员授权后开放，可联系管理员开通。" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">负债管理</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">档案、还款、到期墙与清债策略 —— 看得清，还得动</p>
        </header>

        <FinanceTabs />

        {msg && <div className={`msg-banner mb-4 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>}

        {/* 已有数据时的刷新失败提示（首次加载失败走上方整页错误态） */}
        {loadErr && (
          <div className="msg-banner msg-banner-err mb-4">
            加载失败：{loadErr}
            <button onClick={() => void load()} className="ml-2 underline underline-offset-2">
              重试
            </button>
          </div>
        )}

        {!debts || !ov ? (
          loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button onClick={() => void load()} className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs">
                重试
              </button>
            </div>
          ) : (
            <Skeleton rows={4} className="py-2" />
          )
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

            {/* 备付（REQ-005 R3）：当月应还清单 + 勾选 + 储蓄覆盖 */}
            <ReserveSection />

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
                <div className="flex gap-2">
                  <button
                    onClick={() => setImporting(true)}
                    title="从 trade.ting97.cn 导出的 JSON 导入"
                    className="rounded-xl border border-line-soft px-3 py-1.5 text-xs text-ink-mute transition hover:text-accent"
                  >
                    📥 导入
                  </button>
                  <button onClick={() => setEditing("new")} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20">
                    ＋ 新建档案
                  </button>
                </div>
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
                          title={armArchive.armedId === d.id ? "3 秒内再点确认归档" : "归档（不再统计，可随时恢复）"}
                          onClick={async () => {
                            if (!armArchive.arm(d.id)) return;
                            try {
                              await api(`/api/debts/${d.id}`, "DELETE");
                              setMsg({ ok: true, text: "📦 已归档" });
                              await load();
                            } catch (e) {
                              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                            }
                          }}
                          className={`rounded px-1.5 py-0.5 text-xs ${armArchive.armedId === d.id ? "bg-rose-500/15 font-medium text-danger" : "text-ink-mute hover:bg-soft hover:text-danger"}`}
                        >
                          {armArchive.armedId === d.id ? "确认归档?" : "🗑"}
                        </button>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-dim">
                      <span className="tabular-nums">年化 {d.rate_pct}%</span>
                      {d.monthly_cents != null && <span className="tabular-nums">月供 {fmt(d.monthly_cents)}</span>}
                      {d.pay_day != null && <span>每月 {d.pay_day} 日</span>}
                      {d.due_date && <span>{d.due_date} 到期</span>}
                    </div>
                    {/* 进度条：已还本金占比（余额可能大于本金，宽度和文案都要防负数） */}
                    {d.principal_cents > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, ((d.principal_cents - d.balance_cents) / d.principal_cents) * 100))}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-ink-faint tabular-nums">
                          已还 {fmt(Math.max(0, d.principal_cents - d.balance_cents))} / 本金 {fmt(d.principal_cents)}
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
                                try {
                                  await api(`/api/debts/${d.id}`, "PATCH", { status: "active" });
                                  await load();
                                } catch (e) {
                                  setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                                }
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

      {/* R2 负债导入抽屉 */}
      {importing && (
        <DebtImportDrawer
          open={importing}
          onClose={() => setImporting(false)}
          onDone={async () => {
            setMsg({ ok: true, text: "✅ 导入完成" });
            await load();
          }}
        />
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
