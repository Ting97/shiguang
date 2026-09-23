"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FinanceTabs from "@/components/finance-tabs";
import ModuleLocked from "@/components/module-locked";
import Skeleton from "@/components/skeleton";
import { FilterChip, TagChip } from "@/components/tag-chip";
import { api, ApiClientError } from "@/shared/api";
import DailySection from "./daily-section";
import DigestSection from "./digest-section";
import EquitySection from "./equity-section";
import TradingImportDrawer from "./import-drawer";
import { bjDate, fmtUsd, pnlColor, type TradingAccount } from "./kit";
import TradesSection from "./trades-section";

/**
 * 交易（REQ-005 R1 §3.3）：账号切换 + 汇总卡 → 导入（仅 PC，FR-1.8）→
 * 每日盈亏 → 权益曲线 → 逐笔明细 → 统计 + AI 复盘。金额为 USD 数值（非分）。
 */
export default function TradingPage() {
  const [accounts, setAccounts] = useState<TradingAccount[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isPc, setIsPc] = useState(false);
  const [rev, setRev] = useState(0);

  const load = useCallback(async () => {
    try {
      const j = await api<{ accounts: TradingAccount[] }>("/api/trading/accounts");
      setAccounts(j.accounts);
      setActiveId((cur) => (cur && j.accounts.some((a) => a.id === cur) ? cur : j.accounts[0]?.id ?? null));
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403) {
        setLocked(true);
        setAccounts([]);
        return;
      }
      throw e;
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // FR-1.8 导入入口仅 PC（精细指针 + ≥768px）；触屏/PWA 无任何写入口
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (min-width: 768px)");
    const upd = () => setIsPc(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  const active = useMemo(() => accounts?.find((a) => a.id === activeId) ?? null, [accounts, activeId]);

  if (locked) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <ModuleLocked title="交易" desc="该模块由管理员授权后开放，可联系管理员开通。" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">交易</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">MT5 报表导入 · 权益曲线 · 归类复盘 —— 盈亏看得清</p>
        </header>

        <FinanceTabs />

        {!accounts ? (
          <Skeleton rows={4} className="py-2" />
        ) : (
          <>
            {/* 账号切换 + 汇总卡 + 导入入口 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <div className="flex flex-wrap items-center gap-2">
                <TagChip icon="🎯" label="交易账号" tone="sky" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {accounts.map((a) => (
                    <FilterChip
                      key={a.id}
                      label={a.nickname ? `${a.login} · ${a.nickname}` : a.login}
                      variant="filter"
                      active={a.id === activeId}
                      onClick={() => setActiveId(a.id)}
                    />
                  ))}
                  {accounts.length === 0 && <span className="text-xs text-ink-faint">暂无账号</span>}
                </div>
                {isPc && (
                  <button
                    onClick={() => setImporting(true)}
                    title="上传 MT5 ReportHistory 或 CSV"
                    className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20"
                  >
                    📥 导入报表
                  </button>
                )}
              </div>

              {active && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-3 text-center sm:grid-cols-5">
                  <div>
                    <p className="text-[11px] text-ink-dim">总净盈亏</p>
                    <p className={`mt-1 text-xl font-bold tabular-nums ${pnlColor(active.netProfit)}`}>
                      {fmtUsd(active.netProfit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-ink-dim">胜率</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">
                      {active.winRate != null ? `${active.winRate}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-ink-dim">笔数</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">{active.trades}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-ink-dim">总手数</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">{active.lots.toFixed(2)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-[11px] text-ink-dim">平仓区间</p>
                    <p className="mt-1.5 text-xs font-semibold tabular-nums text-ink-soft">
                      {active.firstClose ? `${bjDate(active.firstClose)}` : "—"}
                      {active.lastClose ? ` ~ ${bjDate(active.lastClose)}` : ""}
                    </p>
                  </div>
                </div>
              )}
            </section>

            {accounts.length === 0 ? (
              <section className="glass rounded-2xl p-8 text-center text-sm text-ink-dim">
                还没有交易账号 ——{" "}
                {isPc
                  ? "点「📥 导入报表」上传 MT5 ReportHistory（xlsx）或 CSV 开始"
                  : "在 PC 端登录后导入 MT5 报表（本端只读）"}
              </section>
            ) : (
              activeId && (
                <div key={`${activeId}-${rev}`}>
                  <DailySection accountId={activeId} />
                  <EquitySection accountId={activeId} />
                  <TradesSection accountId={activeId} />
                  <DigestSection accountId={activeId} />
                </div>
              )
            )}

            <footer className="mt-10 text-center text-[10px] text-ink-faint">
              拾光 · 交易 · 独立核算不入净资产，统计零 AI 消耗
            </footer>
          </>
        )}
      </div>

      {importing && (
        <TradingImportDrawer
          onClose={() => setImporting(false)}
          onImported={async () => {
            await load();
            setRev((r) => r + 1);
          }}
        />
      )}
    </main>
  );
}
