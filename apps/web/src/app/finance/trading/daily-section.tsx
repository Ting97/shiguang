"use client";

import { useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import { TagChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { addDays, bjToday, fmtUsd, groupByWeek, pnlColor, type DailyDay, type WeekDay } from "./kit";

/** 北京当月/上月 YYYY-MM-DD 边界（北京时区） */
const bjMonthRange = (offset: number): [string, string] => {
  const now = new Date(Date.now() + 8 * 3600_000);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
};

/** 每日/每周盈亏（FR-1.4）：柱状（正负着色）+ 列表；支持筛选某一天或任意时间段，周视图可点击某周聚焦 */
export default function DailySection({ accountId }: { accountId: string }) {
  const [days, setDays] = useState<DailyDay[] | null>(null);
  const [mode, setMode] = useState<"day" | "week">("day");
  // 加载失败态：错误显式呈现 + 重试，不再 setDays([]) 伪装成「暂无平仓记录」（与 equity-section 一致）
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  // 筛选：空 = 默认（日视图近 30 个交易日；周视图近 100 天）
  const [fromSel, setFromSel] = useState("");
  const [toSel, setToSel] = useState("");

  useEffect(() => {
    let live = true;
    setDays(null);
    setLoadErr(null);
    const to = toSel || bjToday();
    const from = fromSel || addDays(to, -100); // 默认多取窗口，日视图切片出近 30 个「有交易」的交易日
    api<{ days: DailyDay[] }>(`/api/trading/daily?accountId=${accountId}&from=${from}&to=${to}`)
      .then((j) => {
        if (!live) return;
        if (fromSel || toSel) setDays(j.days); // 自定义筛选：完整呈现所选范围
        else setDays(j.days.slice(-30));
      })
      .catch((e) => {
        if (live) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [accountId, rev, fromSel, toSel]);

  function retry() {
    setLoadErr(null);
    setRev((r) => r + 1);
  }

  const weeks: WeekDay[] = days ? groupByWeek(days) : [];
  const view = mode === "week" ? weeks : (days ?? []);
  const maxAbs = Math.max(1, ...view.map((d) => Math.abs(d.net)));
  const [curMonthFrom, curMonthTo] = bjMonthRange(0);
  const [prevMonthFrom, prevMonthTo] = bjMonthRange(-1);
  const filtered = fromSel !== "" || toSel !== "";

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <p className="mb-3 flex items-center gap-2">
        <TagChip icon="📅" label={mode === "week" ? "每周盈亏" : "每日盈亏"} tone="sky" />
        <span className="text-[10px] text-ink-faint">{filtered ? `${fromSel || "…"} ~ ${toSel || "今天"}` : "按北京时区切日"}</span>
        <span className="ml-auto flex overflow-hidden rounded-lg border border-line-strong text-[10px]">
          <button
            onClick={() => setMode("day")}
            className={`px-2 py-0.5 ${mode === "day" ? "bg-sky-500/15 font-medium text-sky-400" : "text-ink-dim"}`}
          >
            日
          </button>
          <button
            onClick={() => setMode("week")}
            className={`px-2 py-0.5 ${mode === "week" ? "bg-sky-500/15 font-medium text-sky-400" : "text-ink-dim"}`}
          >
            周
          </button>
        </span>
      </p>

      {/* 时间筛选：快捷段（近30天/本月/上月）+ 自定义起止（start==end 即看某一天） */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[10px]">
        <button
          onClick={() => {
            setFromSel("");
            setToSel("");
          }}
          className={`rounded-full px-2 py-0.5 ${!filtered ? "bg-sky-500/15 font-medium text-sky-400" : "border border-line-strong text-ink-dim"}`}
        >
          近 30 天
        </button>
        <button
          onClick={() => {
            setFromSel(curMonthFrom);
            setToSel(curMonthTo > bjToday() ? bjToday() : curMonthTo);
          }}
          className={`rounded-full px-2 py-0.5 ${filtered && fromSel === curMonthFrom ? "bg-sky-500/15 font-medium text-sky-400" : "border border-line-strong text-ink-dim"}`}
        >
          本月
        </button>
        <button
          onClick={() => {
            setFromSel(prevMonthFrom);
            setToSel(prevMonthTo);
          }}
          className={`rounded-full px-2 py-0.5 ${filtered && fromSel === prevMonthFrom ? "bg-sky-500/15 font-medium text-sky-400" : "border border-line-strong text-ink-dim"}`}
        >
          上月
        </button>
        <span className="ml-auto flex items-center gap-1">
          <input
            type="date"
            value={fromSel}
            onChange={(e) => setFromSel(e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-1.5 py-0.5 text-[10px] outline-none focus:border-sky-500"
            aria-label="开始日期"
          />
          <span className="text-ink-faint">~</span>
          <input
            type="date"
            value={toSel}
            onChange={(e) => setToSel(e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-1.5 py-0.5 text-[10px] outline-none focus:border-sky-500"
            aria-label="结束日期"
          />
        </span>
      </div>
      {!days ? (
        loadErr ? (
          <div className="py-4 text-center">
            <p className="text-xs text-danger">加载失败：{loadErr}</p>
            <button onClick={retry} className="btn-primary mt-2 rounded-lg px-4 py-1.5 text-[11px] font-medium">
              重试
            </button>
          </div>
        ) : (
          <Skeleton rows={2} />
        )
      ) : days.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">暂无平仓记录</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-1">
            {view.map((d, i) => {
              const isCur = i === view.length - 1;
              const h = Math.max(4, (Math.abs(d.net) / maxAbs) * 64);
              const label =
                mode === "week"
                  ? `${(d as WeekDay).weekStart.slice(5).replace("-", "/")}~${(d as WeekDay).weekEnd.slice(5).replace("-", "/")}`
                  : (d as DailyDay).ymd;
              return (
                <div key={mode === "week" ? (d as WeekDay).weekStart : (d as DailyDay).ymd} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    title={`${label}：${d.count} 笔 · ${d.lots.toFixed(2)} 手 · 净 ${fmtUsd(d.net)}${
                      mode === "day" && (d as DailyDay).prevNet != null ? `（前一日 ${fmtUsd((d as DailyDay).prevNet!)}）` : ""
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
                      {mode === "week"
                        ? Number(label.slice(0, 2))
                        : `${Number(label.slice(0, 2))}/${Number(label.slice(3, 5))}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[9px] text-ink-faint">
            <span className="text-success">▮</span> 盈利日 <span className="text-danger">▮</span> 亏损日
          </p>

          {/* 横向滚动防溢出：固定列宽合计超 375px 小屏（不重排列，溢出可左右滑） */}
          <div className="mt-3 overflow-x-auto border-t border-line-soft pt-3">
            <div className="flex items-center gap-2 px-1 pb-1 text-[10px] text-ink-faint">
              <span className="w-20">日期</span>
              <span className="w-10 text-right">笔数</span>
              <span className="w-16 text-right">手数</span>
              {mode === "day" ? (
                <>
                  <span className="w-10 text-right">胜率</span>
                  <span className="w-16 text-right">连赢/亏</span>
                </>
              ) : (
                <span className="w-28 shrink-0 text-right">盈利天/交易天</span>
              )}
              <span className="min-w-16 flex-1 text-right">净盈亏</span>
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {[...view].reverse().map((d) =>
                mode === "week" ? (
                  <li
                    key={(d as WeekDay).weekStart}
                    onClick={() => {
                      setFromSel((d as WeekDay).weekStart);
                      setToSel((d as WeekDay).weekEnd > bjToday() ? bjToday() : (d as WeekDay).weekEnd);
                    }}
                    title="点击查看该周每日明细"
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-xs hover:bg-wash/60"
                  >
                    <span className="w-20 shrink-0 tabular-nums text-ink-soft">
                      {(d as WeekDay).weekStart.slice(5).replace("-", "/")}~{(d as WeekDay).weekEnd.slice(8)}
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-ink-mute">{d.count}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-ink-mute">{d.lots.toFixed(2)}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-ink-dim">
                      {(d as WeekDay).upDays}/{(d as WeekDay).days}
                    </span>
                    <span className={`min-w-16 flex-1 text-right font-semibold tabular-nums ${pnlColor(d.net)}`}>{fmtUsd(d.net)}</span>
                  </li>
                ) : (
                  <li key={(d as DailyDay).ymd} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs hover:bg-wash/60">
                    <span className="w-20 shrink-0 tabular-nums text-ink-soft">{(d as DailyDay).ymd.slice(5).replace("-", "/")}</span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-ink-mute">{d.count}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-ink-mute">{d.lots.toFixed(2)}</span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-ink-dim">
                      {(d as DailyDay).winRate != null ? `${(d as DailyDay).winRate}%` : "—"}
                    </span>
                    <span className="w-16 shrink-0 text-right">
                      {(d as DailyDay).streak > 0 && (
                        <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-success">连赢{(d as DailyDay).streak}</span>
                      )}
                      {(d as DailyDay).streak < 0 && (
                        <span className="rounded bg-rose-500/15 px-1 text-[10px] text-danger">连亏{-(d as DailyDay).streak}</span>
                      )}
                      {(d as DailyDay).streak === 0 && <span className="text-ink-faint">—</span>}
                    </span>
                    <span className={`min-w-16 flex-1 text-right font-semibold tabular-nums ${pnlColor(d.net)}`}>{fmtUsd(d.net)}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
