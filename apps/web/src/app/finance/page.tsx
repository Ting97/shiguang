"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "@/components/skeleton";
import BillImport from "@/components/bill-import";
import FinanceTabs from "@/components/finance-tabs";
import { yuan } from "@/lib/finance";
import { api } from "@/shared/api";

import {
  type Tx,
  type Overview,
  monthTitle,
  shiftMonth,
  nowMonth,
} from "../../components/finance/kit";
import { TxForm, AccountManager } from "../../components/finance/forms";
import { Modal } from "../../components/finance/display";
import { OverviewCard } from "../../components/finance/display-overview";
import { AccountsCard } from "../../components/finance/accounts-card";
import { DraftConfirmSection } from "../../components/finance/tx-confirm-list";
import { ConfirmedTxSection } from "../../components/finance/tx-confirmed-list";

export default function FinancePage() {
  const [month, setMonth] = useState(nowMonth());
  const [ov, setOv] = useState<Overview | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
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
    setLoadErr(null);
    try {
      const [o, t] = await Promise.all([
        api<Overview>(`/api/finance/overview?month=${month}`),
        api<{ transactions?: Tx[] }>(`/api/transactions?month=${month}`),
      ]);
      setOv(o);
      setTxs(t.transactions ?? []);
    } catch (e) {
      // 失败不停在骨架屏（历史 bug：无 catch 时 unhandled rejection + 永久加载中）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const drafts = useMemo(() => txs.filter((t) => t.is_draft), [txs]);
  const confirmed = useMemo(() => txs.filter((t) => !t.is_draft), [txs]);

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
          {loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button onClick={() => void load()} className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs">
                重试
              </button>
            </div>
          ) : (
            <Skeleton rows={3} className="py-2" />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
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

        {/* 已有数据时的刷新失败提示（首次加载失败走上方整页错误态） */}
        {loadErr && (
          <div className="msg-banner msg-banner-err mb-4">
            加载失败：{loadErr}
            <button onClick={() => void load()} className="ml-2 underline underline-offset-2">
              重试
            </button>
          </div>
        )}

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
        <OverviewCard
          ov={ov}
          editingBudget={editingBudget}
          onEditBudget={setEditingBudget}
          onBudgetSaved={async () => {
            setMsg({ ok: true, text: "💾 月度上限已保存" });
            await load();
          }}
        />

        {/* 账户 */}
        <AccountsCard accounts={ov.accounts} onManage={() => setManagingAccount(true)} />

        {/* 草稿确认区 */}
        <DraftConfirmSection
          drafts={drafts}
          accounts={ov.accounts}
          confirming={confirming}
          setConfirming={setConfirming}
          confirmAll={confirmAll}
          setConfirmAll={setConfirmAll}
          onConfirm={confirmTx}
          onConfirmAll={confirmAllTx}
          onEdit={setEditing}
          onRemove={removeTx}
        />

        {/* 已确认流水 */}
        <ConfirmedTxSection
          txs={confirmed}
          accounts={ov.accounts}
          editing={editing}
          setEditing={setEditing}
          onSubmitEdit={async (t, payload) => {
            await api(`/api/transactions/${t.id}`, "PATCH", payload);
            setEditing(null);
            setMsg({ ok: true, text: "💾 流水已更新" });
            await load();
          }}
          onRemove={removeTx}
        />

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
