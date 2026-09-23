"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/shared/api";
import { bjToday, fmt } from "./kit";

/** GET /api/debts/reserve 返回（REQ-005 FR-3.1~3.3） */
interface ReserveData {
  ym: string;
  items: Array<{
    liabilityId: string;
    name: string;
    payDays: number[];
    pay: number;
    extra: number;
    need: number;
    checked: boolean;
    liabilityIds: string[];
  }>;
  totalNeed: number;
  checkedNeed: number;
  savingsCents: number;
  coveragePct: number | null;
}

/**
 * 备付区块（REQ-005 R3）：月切换 → 合并清单（勾选）→ 月进度 → 储蓄覆盖（参与账户可勾选）→ 一键备付。
 */
export default function ReserveSection({ onChanged }: { onChanged?: () => void }) {
  // 北京时间推算：裸 UTC 在每月 1 日 0-8 点会落到上个月
  const [ym, setYm] = useState(() => bjToday().slice(0, 7));
  const [data, setData] = useState<ReserveData | null>(null);
  const [savings, setSavings] = useState<Array<{ id: string; name: string; balanceCents: number; reserveTracked: boolean }>>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // seq 守卫：快速切月时旧响应可能后到，只让最新请求落地
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await api<ReserveData>(`/api/debts/reserve?ym=${ym}`);
      if (seq !== loadSeq.current) return; // 过期响应丢弃
      setData(r);
      const a = await api<{ accounts?: Array<{ id: string; name: string; balanceCents: number; reserveTracked?: boolean }> }>("/api/accounts");
      if (seq !== loadSeq.current) return;
      setSavings((a.accounts ?? []).map((x) => ({ id: x.id, name: x.name, balanceCents: x.balanceCents, reserveTracked: Boolean(x.reserveTracked) })));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof ApiClientError && e.status === 403) return; // 未开通模块：整页已是锁定态
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, [ym]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(liabilityId: string, checked: boolean) {
    setBusy(true);
    try {
      // 合并组「组内任一勾选即整组已勾」：取消勾选只发单 id 会对组内其他行静默无效，
      // 须把该行整组 liabilityIds 逐个取消（PUT 只收单个 id）；勾选发单 id 即可
      const ids = checked
        ? [liabilityId]
        : (data?.items.find((r) => r.liabilityId === liabilityId)?.liabilityIds ?? [liabilityId]);
      for (const id of ids) {
        await api("/api/debts/reserve", "PUT", { ym, liabilityId: id, checked });
      }
      await load();
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAll(checked: boolean) {
    setBusy(true);
    try {
      await api("/api/debts/reserve", "PUT", { ym, all: checked });
      await load();
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAccount(id: string, on: boolean) {
    try {
      await api(`/api/accounts/${id}`, "PATCH", { reserveTracked: on });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  function shiftMonth(delta: number) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setYm(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  const pct = data && data.totalNeed > 0 ? Math.round((data.checkedNeed / data.totalNeed) * 100) : 0;
  const gap = data ? data.savingsCents - data.totalNeed : 0;

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          🧰 每月备付
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-line-soft px-2 py-1 text-ink-mute hover:text-ink">‹</button>
          <span className="font-medium tabular-nums text-ink">{ym.slice(0, 4)}年{Number(ym.slice(5))}月</span>
          <button onClick={() => shiftMonth(1)} className="rounded-lg border border-line-soft px-2 py-1 text-ink-mute hover:text-ink">›</button>
          <button
            onClick={() => void toggleAll(true)}
            disabled={busy || !data || data.items.length === 0}
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-accent transition hover:bg-sky-500/20 disabled:opacity-40"
          >
            一键备付
          </button>
          <button
            onClick={() => void toggleAll(false)}
            disabled={busy || !data || data.items.length === 0}
            className="rounded-lg border border-line-soft px-2.5 py-1 text-[11px] text-ink-mute transition hover:text-danger disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      {!data ? (
        <p className="py-3 text-center text-xs text-ink-faint">加载中…</p>
      ) : data.items.length === 0 ? (
        <p className="py-3 text-center text-xs text-ink-faint">本月没有进行中的负债应还</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {data.items.map((r) => (
              <li
                key={r.liabilityId}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-xs ${
                  r.checked ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-line-soft bg-bg/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) => void toggle(r.liabilityId, e.target.checked)}
                  className="size-4 accent-emerald-500"
                  aria-label={`勾选备付 ${r.name}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {r.name}
                  {r.payDays.length > 0 && <span className="ml-1.5 text-[10px] text-ink-faint">{r.payDays.join("/")} 日</span>}
                  {r.extra > 0 && <span className="ml-1.5 rounded bg-rose-500/15 px-1 text-[10px] text-danger">本月到期</span>}
                </span>
                <span className="text-[10px] text-ink-faint tabular-nums">
                  月供 {fmt(r.pay)}{r.extra > 0 && ` + 到期本金 ${fmt(r.extra)}`}
                </span>
                <span className="font-semibold tabular-nums text-ink">{fmt(r.need)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="flex items-center justify-between text-[11px] text-ink-mute">
              <span>
                已备付 <span className="font-semibold tabular-nums text-success">{fmt(data.checkedNeed)}</span> / {fmt(data.totalNeed)}
              </span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-line-soft bg-bg/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
              <span className="text-ink-mute">
                储蓄覆盖（
                {savings.length === 0 && <span className="text-ink-faint">尚未勾选参与账户</span>}
                ）
                <span className={`ml-1.5 font-semibold tabular-nums ${gap >= 0 ? "text-success" : "text-danger"}`}>{fmt(data.savingsCents)}</span>
                <span className="text-ink-faint"> vs 应还 {fmt(data.totalNeed)}</span>
                {data.coveragePct != null && (
                  <span className={`ml-1.5 font-semibold ${data.coveragePct >= 100 ? "text-success" : "text-danger"}`}>{data.coveragePct}%</span>
                )}
                {gap < 0 && <span className="ml-1 text-danger">缺口 {fmt(Math.abs(gap))}</span>}
              </span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {savings.map((a) => (
                <li key={a.id}>
                  <label className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                    a.reserveTracked ? "border-sky-500/40 bg-sky-500/10 text-accent" : "border-line-soft text-ink-mute hover:text-ink"
                  }`}>
                    <input
                      type="checkbox"
                      checked={a.reserveTracked}
                      onChange={(e) => void toggleAccount(a.id, e.target.checked)}
                      className="size-3 accent-sky-500"
                    />
                    {a.name} <span className="tabular-nums opacity-70">{fmt(a.balanceCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {msg && <p className={`mt-2 text-[11px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
    </section>
  );
}
