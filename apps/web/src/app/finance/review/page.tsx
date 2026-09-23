"use client";

import { useCallback, useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import FinanceTabs from "@/components/finance-tabs";
import ModuleLocked from "@/components/module-locked";
import { TagChip, FilterChip } from "@/components/tag-chip";
import { TX_COLORS, yuan } from "@/lib/finance";
import { api, ApiClientError } from "@/shared/api";

/**
 * 交易复盘（REQ-003 3-F FR-C2.7）：日/周统计（纯 SQL）+ AI 交易周报（缓存/配额走复盘管线）。
 */

interface Stats {
  period: "day" | "week";
  date: string;
  range: { from: string; to: string };
  totals: { inCents: number; outCents: number; count: number };
  prev: { inCents: number; outCents: number };
  byCategory: { category: string; cents: number; pct: number }[];
  byAccount: { name: string; icon: string; inCents: number; outCents: number }[];
  topCounterparties: { name: string; count: number; outCents: number }[];
  daily: { date: string; inCents: number; outCents: number }[];
}
interface Review {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

const fmt = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);
const momPct = (cur: number, base: number) => (base > 0 ? Math.round(((cur - base) / base) * 100) : null);

function bjToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function mondayOf(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function FinanceReviewPage() {
  const [locked, setLocked] = useState(false);
  const [period, setPeriod] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(bjToday());
  const [stats, setStats] = useState<Stats | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewMeta, setReviewMeta] = useState<{ cached: boolean; generatedAt: string; range: { from: string; to: string } } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rangeFrom = period === "week" ? mondayOf(anchor) : anchor;

  const loadStats = useCallback(async () => {
    try {
      setStats(await api<Stats>(`/api/finance/stats?period=${period}&date=${anchor}`));
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403) {
        setLocked(true);
        return;
      }
      setStats(null);
    }
  }, [period, anchor]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // 切周/进页面：只读缓存（GET 不耗配额）；生成本身只由按钮触发
  const loadReview = useCallback(async (refresh = false) => {
    if (period !== "week") return;
    if (refresh) {
      setGenBusy(true);
      setMsg(null);
      try {
        const j = await api<any>("/api/finance/review/week", "POST", { date: mondayOf(anchor), refresh: true });
        setReview(j.review);
        setReviewMeta({ cached: j.cached, generatedAt: j.generatedAt, range: j.range });
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setGenBusy(false);
      }
      return;
    }
    try {
      const j = await api<any>(`/api/finance/review/week?date=${mondayOf(anchor)}`);
      if (j.review) {
        setReview(j.review);
        setReviewMeta({ cached: true, generatedAt: j.generatedAt, range: j.range });
      } else {
        setReview(null);
        setReviewMeta(null);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 403) {
        setLocked(true);
        return;
      }
      setReview(null);
      setReviewMeta(null);
    }
  }, [period, anchor]);

  useEffect(() => {
    setReview(null);
    setReviewMeta(null);
    void loadReview(false);
  }, [loadReview]);

  if (locked) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <ModuleLocked title="交易复盘" desc="该模块由管理员授权后开放，可联系管理员开通。" />
        </div>
      </main>
    );
  }

  const outMom = stats ? momPct(stats.totals.outCents, stats.prev.outCents) : null;
  const inMom = stats ? momPct(stats.totals.inCents, stats.prev.inCents) : null;
  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => Math.max(d.outCents, d.inCents))) : 1;
  const reviewForThisWeek = review && reviewMeta && reviewMeta.range.from === rangeFrom ? review : null;

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">交易复盘</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">日/周收支结构与 AI 周报 —— 花在哪、怎么调</p>
        </header>

        <FinanceTabs />

        {/* 日/周切换 + 日期导航 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-full border border-line-soft bg-surface/70 p-1">
            <FilterChip label="日" active={period === "day"} onClick={() => setPeriod("day")} variant="pill" />
            <FilterChip label="周" active={period === "week"} onClick={() => setPeriod("week")} variant="pill" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setAnchor(addDays(anchor, period === "day" ? -1 : -7))} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 transition hover:border-sky-500/50">‹</button>
            <span className="min-w-36 text-center font-semibold tabular-nums text-ink">
              {period === "day" ? anchor : `${md(rangeFrom)} ~ ${md(addDays(rangeFrom, 6))}`}
            </span>
            <button
              onClick={() => setAnchor(addDays(anchor, period === "day" ? 1 : 7))}
              disabled={period === "day" ? anchor >= bjToday() : mondayOf(anchor) >= mondayOf(bjToday())}
              className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 transition hover:border-sky-500/50 disabled:opacity-30"
            >
              ›
            </button>
            <button
              onClick={() => setAnchor(bjToday())}
              className="rounded-lg px-2 py-1.5 text-[11px] text-ink-mute hover:text-accent"
            >
              今
            </button>
          </div>
        </div>

        {msg && <div className="msg-banner msg-banner-err mb-4">{msg}</div>}

        {!stats ? (
          <Skeleton rows={3} className="py-2" />
        ) : (
          <>
            {/* 统计卡 */}
            <section className="glass mb-4 rounded-2xl p-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[11px] text-ink-dim">{period === "day" ? "当日支出" : "本周支出"}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-danger">{fmt(stats.totals.outCents)}</p>
                  {outMom != null && (
                    <p className={`mt-0.5 text-[10px] tabular-nums ${outMom > 0 ? "text-danger" : "text-success"}`}>
                      环比 {outMom > 0 ? "+" : ""}{outMom}%
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-ink-dim">{period === "day" ? "当日收入" : "本周收入"}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-success">{fmt(stats.totals.inCents)}</p>
                  {inMom != null && (
                    <p className={`mt-0.5 text-[10px] tabular-nums ${inMom > 0 ? "text-success" : "text-danger"}`}>
                      环比 {inMom > 0 ? "+" : ""}{inMom}%
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-ink-dim">笔数</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-ink">{stats.totals.count}</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">
                    结余 <span className={stats.totals.inCents - stats.totals.outCents >= 0 ? "text-success" : "text-danger"}>{fmt(stats.totals.inCents - stats.totals.outCents)}</span>
                  </p>
                </div>
              </div>
            </section>

            {/* 周内日趋势 */}
            {period === "week" && (
              <section className="glass mb-4 rounded-2xl p-5">
                <p className="mb-3"><TagChip icon="📊" label="日趋势" tone="sky" /></p>
                <div className="flex items-end justify-between gap-2">
                  {stats.daily.map((d) => (
                    <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex h-16 w-full items-end justify-center gap-0.5">
                        <div
                          title={`支出 ${fmt(d.outCents)}`}
                          className="w-2.5 rounded-t bg-gradient-to-t from-rose-600/50 to-rose-400/80"
                          style={{ height: d.outCents > 0 ? Math.max(3, (d.outCents / maxDaily) * 64) : 2 }}
                        />
                        <div
                          title={`收入 ${fmt(d.inCents)}`}
                          className="w-2.5 rounded-t bg-gradient-to-t from-emerald-600/50 to-emerald-400/80"
                          style={{ height: d.inCents > 0 ? Math.max(3, (d.inCents / maxDaily) * 64) : 2 }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums text-ink-faint">{Number(d.date.slice(8))}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-center text-[9px] text-ink-faint">
                  <span className="text-danger">▮</span> 支出 <span className="text-success">▮</span> 收入
                </p>
              </section>
            )}

            {/* 分类占比 */}
            {stats.byCategory.length > 0 && (
              <section className="glass mb-4 rounded-2xl p-5">
                <p className="mb-3"><TagChip icon="🧩" label="支出分类" tone="rose" /></p>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                  {stats.byCategory.map((s) => (
                    <div
                      key={s.category}
                      title={`${s.category} ${fmt(s.cents)}（${s.pct}%）`}
                      style={{ width: `${s.pct}%`, backgroundColor: TX_COLORS[s.category] ?? "#64748b" }}
                    />
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {stats.byCategory.map((s) => (
                    <li key={s.category} className="flex items-center gap-2 text-xs">
                      <span className="w-16 shrink-0 truncate text-ink-mute">{s.category}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-elevated">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-400" style={{ width: `${s.pct}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-ink">{fmt(s.cents)}</span>
                      <span className="w-12 shrink-0 text-right tabular-nums text-ink-faint">{s.pct}%</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 账户分布 + Top 对方 */}
            <section className="mb-4 grid gap-4 sm:grid-cols-2">
              {stats.byAccount.length > 0 && (
                <div className="glass rounded-2xl p-5">
                  <p className="mb-3"><TagChip icon="💳" label="账户分布" tone="sky" /></p>
                  <ul className="space-y-1.5">
                    {stats.byAccount.map((a) => (
                      <li key={a.name} className="flex items-center gap-2 text-xs">
                        <span>{a.icon}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-mute">{a.name}</span>
                        <span className="tabular-nums text-danger">{a.outCents > 0 ? `-${fmt(a.outCents)}` : ""}</span>
                        {a.inCents > 0 && <span className="tabular-nums text-success">+{fmt(a.inCents)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {stats.topCounterparties.length > 0 && (
                <div className="glass rounded-2xl p-5">
                  <p className="mb-3"><TagChip icon="🤝" label="Top 对方" tone="violet" /></p>
                  <ul className="space-y-1.5">
                    {stats.topCounterparties.map((p) => (
                      <li key={p.name} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-ink-mute">{p.name}</span>
                        <span className="text-ink-faint">{p.count} 笔</span>
                        <span className="tabular-nums text-danger">{fmt(p.outCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* AI 周报卡（仅周视图） */}
            {period === "week" && (
              <section className="glass mb-4 rounded-2xl p-5">
                <div className="mb-3 flex items-center justify-between">
                  <TagChip icon="🤖" label="AI 交易周报" tone="emerald" />
                  <span className="flex items-center gap-2">
                    {reviewMeta && reviewForThisWeek && (
                      <span className="text-[10px] text-ink-faint">
                        {reviewMeta.cached ? "缓存" : "已生成"} · {new Date(reviewMeta.generatedAt).getMonth() + 1}/{new Date(reviewMeta.generatedAt).getDate()}
                      </span>
                    )}
                    <button
                      onClick={() => void loadReview(true)}
                      disabled={genBusy}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-40 dark:text-emerald-400"
                    >
                      {genBusy ? "生成中…" : reviewForThisWeek ? "重新生成" : "生成周报"}
                    </button>
                  </span>
                </div>
                {genBusy && !reviewForThisWeek && <p className="py-2 text-center text-xs text-ink-dim">正在读取本周流水并生成解读…</p>}
                {reviewForThisWeek ? (
                  <div className="space-y-3">
                    <p className="text-sm leading-relaxed text-ink">{reviewForThisWeek.summary}</p>
                    {reviewForThisWeek.highlights.length > 0 && (
                      <ul className="space-y-1">
                        {reviewForThisWeek.highlights.map((h, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-ink-soft"><span className="text-success">◆</span>{h}</li>
                        ))}
                      </ul>
                    )}
                    {reviewForThisWeek.suggestions.length > 0 && (
                      <ul className="space-y-1 border-t border-line-soft pt-2">
                        {reviewForThisWeek.suggestions.map((s, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-ink-mute"><span className="text-accent">✦</span>{s}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  !genBusy && <p className="py-2 text-center text-xs text-ink-faint">点「生成周报」让 AI 解读本周收支（走 AI 配额，结果缓存）</p>
                )}
              </section>
            )}

            <footer className="mt-10 text-center text-[10px] text-ink-faint">拾光 · 交易复盘 · 统计零 AI 消耗，周报走 AI 配额</footer>
          </>
        )}
      </div>
    </main>
  );
}
