"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FinanceTabs from "@/components/finance-tabs";
import ModuleLocked from "@/components/module-locked";
import Skeleton from "@/components/skeleton";
import { FilterChip, TagChip } from "@/components/tag-chip";
import { api, ApiClientError } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import DailySection from "./daily-section";
import DigestSection from "./digest-section";
import EquitySection from "./equity-section";
import BitgetDrawer from "./bitget-drawer";
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
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bitgetOpen, setBitgetOpen] = useState(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [isPc, setIsPc] = useState(false);
  const [rev, setRev] = useState(0);

  const load = useCallback(async () => {
    setLoadErr(null);
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
      // 非 403 的失败不停在骨架屏（历史 bug：throw 造成 unhandled rejection + 永久加载中）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** 一键同步：对每把已绑定的 Bitget 密钥各做一次增量同步（from 缺省=最后平仓日-1 天，
   * 服务端只翻几页即停，避开限频）；未绑定任何密钥时打开绑定抽屉引导 */
  const quickSync = useCallback(async () => {
    if (quickSyncing) return;
    setQuickSyncing(true);
    try {
      const st = await api<{ bound: boolean; keys?: { label: string }[] }>("/api/trading/bitget/keys");
      const labels = st.keys?.map((k) => k.label) ?? [];
      if (labels.length === 0) {
        setQuickSyncing(false);
        setBitgetOpen(true);
        return;
      }
      const parts: string[] = [];
      for (const label of labels) {
        const r = await api<{ rowsNew: number; rowsDup: number; fromUsed: string; toUsed: string }>(
          "/api/trading/bitget/sync",
          "POST",
          { keyLabel: label, dryRun: false },
        );
        parts.push(`「${label}」${r.fromUsed}~${r.toUsed} 新增 ${r.rowsNew} · 重复 ${r.rowsDup}`);
      }
      toast(`✅ 同步完成：${parts.join("；")}`);
      await load();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "同步失败，请稍后再试", "err");
    } finally {
      setQuickSyncing(false);
    }
  }, [quickSyncing, load]);

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
          <p className="mt-2 text-xs text-ink-dim">MT5 报表 / Bitget CFD 同步 · 权益曲线 · 归类复盘 —— 盈亏看得清</p>
        </header>

        <FinanceTabs />

        {/* 已有账号数据时的刷新失败提示（首次加载失败走下方整页错误态） */}
        {accounts && loadErr && (
          <div className="msg-banner msg-banner-err mb-4">
            加载失败：{loadErr}
            <button onClick={() => void load()} className="ml-2 underline underline-offset-2">
              重试
            </button>
          </div>
        )}

        {!accounts ? (
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
            {/* 账号切换 + 汇总卡 + 导入入口 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <div className="flex flex-wrap items-center gap-2">
                <TagChip icon="🎯" label="交易账号" tone="sky" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {accounts.map((a) => (
                    <FilterChip
                      key={a.id}
                      label={`${a.source === "bitget" ? "⚡" : ""}${a.nickname ? `${a.login} · ${a.nickname}` : a.login}`}
                      variant="filter"
                      active={a.id === activeId}
                      onClick={() => setActiveId(a.id)}
                    />
                  ))}
                  {accounts.length === 0 && <span className="text-xs text-ink-faint">暂无账号</span>}
                </div>
                {/* 一键同步全端开放（移动 Web 也可用）；⚙ 打开绑定/自定义同步抽屉；MT5 报表导入仍仅 PC（FR-1.8） */}
                <button
                  onClick={quickSync}
                  disabled={quickSyncing}
                  title="对每把已绑定的 Bitget 密钥各同步近 30 天平仓数据"
                  className="rounded-xl bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
                >
                  {quickSyncing ? "⏳ 同步中…" : "⚡ 一键同步"}
                </button>
                <button
                  onClick={() => setBitgetOpen(true)}
                  title="绑定 Bitget 只读 API / 自定义时间范围同步"
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-warn transition hover:bg-amber-500/20"
                >
                  ⚙
                </button>
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
                    <p className="text-micro text-ink-dim">总净盈亏</p>
                    <p className={`mt-1 text-xl font-bold tabular-nums ${pnlColor(active.netProfit)}`}>
                      {fmtUsd(active.netProfit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-dim">胜率</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">
                      {active.winRate != null ? `${active.winRate}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-dim">笔数</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">{active.trades}</p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-dim">总手数</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">{active.lots.toFixed(2)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-micro text-ink-dim">平仓区间</p>
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
                还没有交易账号 —— 点「⚡ Bitget 同步」绑定自己的只读 API 手动拉取；MT5 用户在 PC 端「📥 导入报表」
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

            <footer className="mt-10 text-center text-badge text-ink-faint">
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

      {bitgetOpen && (
        <BitgetDrawer
          onClose={() => setBitgetOpen(false)}
          onSynced={async () => {
            await load();
            setRev((r) => r + 1);
          }}
        />
      )}
    </main>
  );
}
