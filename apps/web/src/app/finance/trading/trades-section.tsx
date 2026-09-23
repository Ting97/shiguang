"use client";

import { useCallback, useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import { FilterChip, TagChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { bjTime, fmtHold, fmtUsd, pnlColor, type TradesPage } from "./kit";

/** 归类筛选组（与服务端 SQL 分桶一致） */
const GROUPS = [
  {
    key: "dir" as const,
    label: "方向",
    options: [
      { v: "", label: "全部" },
      { v: "buy", label: "买入" },
      { v: "sell", label: "卖出" },
    ],
  },
  {
    key: "period" as const,
    label: "时段",
    options: [
      { v: "", label: "全部" },
      { v: "morning", label: "早" },
      { v: "afternoon", label: "午" },
      { v: "evening", label: "晚" },
      { v: "lateNight", label: "深夜" },
    ],
  },
  {
    key: "durBand" as const,
    label: "时长",
    options: [
      { v: "", label: "全部" },
      { v: "lt15m", label: "<15分" },
      { v: "m15to60", label: "15-60分" },
      { v: "h1to4", label: "1-4时" },
      { v: "gt4h", label: ">4时" },
    ],
  },
  {
    key: "pnlBand" as const,
    label: "盈亏",
    options: [
      { v: "", label: "全部" },
      { v: "win", label: "赢" },
      { v: "loss", label: "亏" },
      { v: "bigWin", label: "大赢" },
      { v: "bigLoss", label: "大亏" },
    ],
  },
];

type Filters = { dir: string; period: string; durBand: string; pnlBand: string };

/** 逐笔明细（FR-1.6）：归类 chips + 分页表（20/页） */
export default function TradesSection({ accountId }: { accountId: string }) {
  const [filters, setFilters] = useState<Filters>({ dir: "", period: "", durBand: "", pnlBand: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TradesPage | null>(null);
  // 加载失败态：错误显式呈现 + 重试，不再 setData(null) 永久骨架（对齐 daily/equity-section）
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setLoadErr(null);
    const sp = new URLSearchParams({ accountId, ...filters, page: String(page) });
    try {
      setData(await api<TradesPage>(`/api/trading/trades?${sp}`));
    } catch (e) {
      setData(null);
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [accountId, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (key: keyof Filters, v: string) => {
    setFilters((f) => (f[key] === v ? f : { ...f, [key]: v }));
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <p className="mb-3 flex items-center gap-2">
        <TagChip icon="📋" label="逐笔明细" tone="violet" />
        {data && <span className="text-[10px] text-ink-faint">共 {data.total} 笔</span>}
      </p>

      <div className="mb-3 space-y-1.5">
        {GROUPS.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-[10px] text-ink-faint">{g.label}</span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {g.options.map((o) => (
                <FilterChip
                  key={o.v}
                  label={o.label}
                  variant="filter"
                  active={filters[g.key] === o.v}
                  onClick={() => pick(g.key, o.v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {!data ? (
        loadErr ? (
          <div className="py-4 text-center">
            <p className="text-xs text-danger">加载失败：{loadErr}</p>
            <button onClick={() => void load()} className="btn-primary mt-2 rounded-lg px-4 py-1.5 text-[11px] font-medium">
              重试
            </button>
          </div>
        ) : (
          <Skeleton rows={3} />
        )
      ) : data.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">该筛选条件下没有成交记录</p>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line-soft px-1 pb-1 text-[10px] text-ink-faint">
            <span className="w-7">方向</span>
            <span className="w-20">品种 · 手数</span>
            <span className="min-w-0 flex-1">开仓 → 平仓（北京）</span>
            <span className="w-14 text-right">时长</span>
            <span className="w-20 text-right">净盈亏</span>
          </div>
          <ul>
            {data.items.map((t) => (
              <li
                key={t.id}
                title={`#${t.ticket} · ${bjTime(t.openTime)} → ${bjTime(t.closeTime)} · ${t.openPrice ?? "—"} → ${t.closePrice ?? "—"}`}
                className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs hover:bg-wash/60"
              >
                <span
                  className={`w-7 shrink-0 rounded px-1 text-center text-[10px] ${
                    t.direction === "buy" ? "bg-sky-500/15 text-accent" : "bg-violet-500/15 text-ai"
                  }`}
                >
                  {t.direction === "buy" ? "买" : "卖"}
                </span>
                <span className="w-20 shrink-0 truncate text-ink-soft">
                  {t.symbol}
                  <span className="ml-0.5 tabular-nums text-ink-faint">{t.lots}</span>
                </span>
                <span className="min-w-0 flex-1 truncate tabular-nums text-ink-dim">
                  {bjTime(t.openTime)} → {bjTime(t.closeTime)}
                </span>
                <span className="w-14 shrink-0 text-right tabular-nums text-ink-dim">{fmtHold(t.holdMinutes)}</span>
                <span className={`w-20 shrink-0 text-right font-semibold tabular-nums ${pnlColor(t.netProfit)}`}>
                  {fmtUsd(t.netProfit)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3 text-xs">
            <button
              disabled={page <= 1 || busy}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 transition hover:border-sky-500/50 disabled:opacity-30"
            >
              ← 上一页
            </button>
            <span className="tabular-nums text-ink-faint">
              第 {data.page} / {totalPages} 页{busy ? " · 加载中…" : ""}
            </span>
            <button
              disabled={page >= totalPages || busy}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 transition hover:border-sky-500/50 disabled:opacity-30"
            >
              下一页 →
            </button>
          </div>
        </>
      )}
    </section>
  );
}
