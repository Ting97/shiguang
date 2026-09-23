"use client";

import { useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import { TagChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { addDays, bjToday, fmtUsd, pnlColor, type DailyDay } from "./kit";

/** 每日盈亏（FR-1.4）：近 30 个交易日柱状（正负着色）+ 日列表（笔数/手数/净盈亏/连赢连亏） */
export default function DailySection({ accountId }: { accountId: string }) {
  const [days, setDays] = useState<DailyDay[] | null>(null);

  useEffect(() => {
    let live = true;
    setDays(null);
    const to = bjToday();
    const from = addDays(to, -100); // 多取窗口，切片出近 30 个「有交易」的交易日
    api<{ days: DailyDay[] }>(`/api/trading/daily?accountId=${accountId}&from=${from}&to=${to}`)
      .then((j) => {
        if (live) setDays(j.days.slice(-30));
      })
      .catch(() => {
        if (live) setDays([]);
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  const maxAbs = Math.max(1, ...(days ?? []).map((d) => Math.abs(d.net)));

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <p className="mb-3 flex items-center gap-2">
        <TagChip icon="📅" label="每日盈亏 · 近 30 个交易日" tone="sky" />
        <span className="text-[10px] text-ink-faint">按北京时区切日</span>
      </p>
      {!days ? (
        <Skeleton rows={2} />
      ) : days.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">暂无平仓记录</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-1">
            {days.map((d, i) => {
              const isCur = i === days.length - 1;
              const h = Math.max(4, (Math.abs(d.net) / maxAbs) * 64);
              return (
                <div key={d.ymd} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    title={`${d.ymd}：${d.count} 笔 · ${d.lots.toFixed(2)} 手 · 净 ${fmtUsd(d.net)}${
                      d.prevNet != null ? `（前一日 ${fmtUsd(d.prevNet)}）` : ""
                    }`}
                    className={`w-full rounded-t transition-colors ${
                      d.net >= 0
                        ? "bg-gradient-to-t from-emerald-600/50 to-emerald-400/80"
                        : "bg-gradient-to-t from-rose-600/50 to-rose-400/80"
                    } ${isCur ? "ring-1 ring-sky-400/60" : ""}`}
                    style={{ height: h }}
                  />
                  {(i % 5 === 0 || isCur) && (
                    <span className={`text-[9px] tabular-nums ${isCur ? "text-ink-soft" : "text-ink-faint"}`}>
                      {Number(d.ymd.slice(5, 7))}/{Number(d.ymd.slice(8))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[9px] text-ink-faint">
            <span className="text-success">▮</span> 盈利日 <span className="text-danger">▮</span> 亏损日
          </p>

          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="flex items-center gap-2 px-1 pb-1 text-[10px] text-ink-faint">
              <span className="w-20">日期</span>
              <span className="w-10 text-right">笔数</span>
              <span className="w-16 text-right">手数</span>
              <span className="w-10 text-right">胜率</span>
              <span className="w-16 text-right">连赢/亏</span>
              <span className="min-w-16 flex-1 text-right">净盈亏</span>
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {[...days].reverse().map((d) => (
                <li key={d.ymd} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs hover:bg-wash/60">
                  <span className="w-20 shrink-0 tabular-nums text-ink-soft">{d.ymd.slice(5).replace("-", "/")}</span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-mute">{d.count}</span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-mute">{d.lots.toFixed(2)}</span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-dim">{d.winRate != null ? `${d.winRate}%` : "—"}</span>
                  <span className="w-16 shrink-0 text-right">
                    {d.streak > 0 && <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-success">连赢{d.streak}</span>}
                    {d.streak < 0 && <span className="rounded bg-rose-500/15 px-1 text-[10px] text-danger">连亏{-d.streak}</span>}
                    {d.streak === 0 && <span className="text-ink-faint">—</span>}
                  </span>
                  <span className={`min-w-16 flex-1 text-right font-semibold tabular-nums ${pnlColor(d.net)}`}>{fmtUsd(d.net)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
