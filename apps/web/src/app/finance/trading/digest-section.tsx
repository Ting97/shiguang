"use client";

import { useCallback, useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import { TagChip } from "@/components/tag-chip";
import { api, ApiClientError } from "@/shared/api";
import { bjTime, BUCKET_LABEL, fmtUsd, pnlColor, type Digest, type ReviewState, type TradingReview } from "./kit";

/** 归类分布小节：bucket 行 + 净盈亏横条 */
function AggList({ title, rows }: { title: string; rows: Digest["aggregations"]["byPeriod"] }) {
  if (!rows.length) return null;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-ink-mute">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.bucket} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate text-ink-dim">{BUCKET_LABEL[r.bucket] ?? r.bucket}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-elevated">
              <div
                className={`h-full rounded-full ${
                  r.net >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-500 to-rose-400"
                }`}
                style={{ width: `${(Math.abs(r.net) / maxAbs) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right tabular-nums text-ink-faint">{r.count}笔</span>
            <span className={`w-16 shrink-0 text-right font-medium tabular-nums ${pnlColor(r.net)}`}>{fmtUsd(r.net)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 「统计」卡（digest 常显）+「AI 复盘」卡（生成/缓存秒显/降级徽标） */
export default function DigestSection({ accountId }: { accountId: string }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  // 加载失败态：错误显式呈现 + 重试，不再永久骨架（对齐 daily/equity-section）
  const [digestErr, setDigestErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [review, setReview] = useState<ReviewState>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDigest(null);
    setReview(null);
    setError(null);
    setDigestErr(null);
    api<Digest>(`/api/trading/digest?accountId=${accountId}`)
      .then((j) => {
        if (live) setDigest(j);
      })
      .catch((e) => {
        if (live) setDigestErr(e instanceof Error ? e.message : String(e));
      });
    // 只读缓存（GET 不耗配额），缓存命中秒显
    api<{ review: TradingReview | null; cached?: boolean; generatedAt?: string }>(`/api/trading/review?accountId=${accountId}`)
      .then((j) => {
        if (live && j.review) setReview({ kind: "ai", review: j.review, cached: true, generatedAt: j.generatedAt ?? "" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId, rev]);

  function retryDigest() {
    setRev((r) => r + 1);
  }

  const generate = useCallback(async () => {
    setGenBusy(true);
    setError(null);
    try {
      const j = await api<{
        review?: TradingReview;
        cached?: boolean;
        generatedAt?: string;
        fallback?: boolean;
        fallbackReason?: string;
        digest?: Digest | null;
      }>("/api/trading/review", "POST", { accountId, refresh: true });
      if (j.fallback) {
        setReview({ kind: "fallback", reason: j.fallbackReason ?? "AI 暂不可用", digest: j.digest ?? null });
      } else if (j.review) {
        setReview({ kind: "ai", review: j.review, cached: Boolean(j.cached), generatedAt: j.generatedAt ?? "" });
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  }, [accountId]);

  const st = digest?.stats;
  const facts = review?.kind === "fallback" ? (review.digest?.facts ?? digest?.facts ?? "").split("\n").filter(Boolean) : [];

  return (
    <>
      {/* 统计卡（规则统计，常显） */}
      <section className="glass mb-4 rounded-2xl p-5">
        <p className="mb-3 flex items-center gap-2">
          <TagChip icon="🧮" label="统计" tone="amber" />
          {st && (
            <span className="text-[10px] text-ink-faint">
              {st.totalTrades} 笔 · 净 {fmtUsd(st.totalNet)}
            </span>
          )}
        </p>
        {!digest ? (
          digestErr ? (
            <div className="py-4 text-center">
              <p className="text-xs text-danger">加载失败：{digestErr}</p>
              <button onClick={retryDigest} className="btn-primary mt-2 rounded-lg px-4 py-1.5 text-[11px] font-medium">
                重试
              </button>
            </div>
          ) : (
            <Skeleton rows={2} />
          )
        ) : (
          <div className="space-y-4">
            {/* 峰值前后两阶段对比 */}
            <div className="grid grid-cols-2 gap-2">
              {(["beforePeak", "afterPeak"] as const).map((k) => {
                const ph = st!.phases[k];
                return (
                  <div key={k} className="rounded-xl border border-line-soft bg-bg/40 p-3 text-center">
                    <p className="text-[11px] text-ink-dim">
                      {k === "beforePeak" ? "峰值前" : "峰值后"}
                      {k === "beforePeak" && st!.peak ? `（≤ ${st!.peak.ymd}）` : ""}
                    </p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${pnlColor(ph.net)}`}>{fmtUsd(ph.net)}</p>
                    <p className="mt-0.5 text-[10px] tabular-nums text-ink-faint">
                      {ph.count} 笔 · 胜率 {ph.winRate != null ? `${ph.winRate}%` : "—"}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* 回撤段列表 */}
            {st!.drawdowns.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-ink-mute">回撤段（按深度）</p>
                <ul className="space-y-1">
                  {st!.drawdowns.map((d, i) => (
                    <li key={`${d.startYmd}-${d.troughYmd}-${i}`} className="flex items-center gap-2 text-[11px]">
                      <span className="w-4 shrink-0 text-ink-faint">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate tabular-nums text-ink-dim">
                        {d.startYmd} → {d.troughYmd}
                        {d.endYmd !== d.troughYmd && <span className="text-ink-faint">（至 {d.endYmd}）</span>}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-danger">-{fmtUsd(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 归类分布 */}
            <AggList title="开仓时段" rows={digest.aggregations.byPeriod} />
            <AggList title="持仓时长" rows={digest.aggregations.byDuration} />
            <AggList title="方向" rows={digest.aggregations.byDirection} />

            {/* 典型逐笔 */}
            {digest.notable.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-ink-mute">典型逐笔</p>
                <ul className="space-y-1">
                  {digest.notable.map((t, i) => (
                    <li key={`${t.label}-${t.ticket}-${i}`} className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                          t.netProfit >= 0 ? "bg-emerald-500/15 text-success" : "bg-rose-500/15 text-danger"
                        }`}
                      >
                        {t.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-dim">
                        #{t.ticket} · {t.symbol} · {t.direction === "buy" ? "买入" : "卖出"} {t.lots} 手
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-faint">{bjTime(t.closeTime)}</span>
                      <span className={`w-16 shrink-0 text-right font-medium tabular-nums ${pnlColor(t.netProfit)}`}>
                        {fmtUsd(t.netProfit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* AI 复盘卡 */}
      <section className="glass mb-4 rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TagChip icon="🤖" label="AI 复盘" tone="emerald" />
            {review?.kind === "fallback" && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-warn">已降级</span>
            )}
            {review?.kind === "ai" && (
              <span className="text-[10px] text-ink-faint">
                {review.cached ? "缓存" : "已生成"}
                {review.generatedAt ? ` · ${bjTime(review.generatedAt)}` : ""}
              </span>
            )}
          </div>
          <button
            onClick={() => void generate()}
            disabled={genBusy}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-40 dark:text-emerald-400"
          >
            {genBusy ? "生成中…" : review ? "重新生成" : "生成复盘"}
          </button>
        </div>

        {error && <p className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}

        {review?.kind === "ai" ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-ink">{review.review.summary}</p>
            {review.review.highlights.length > 0 && (
              <ul className="space-y-1">
                {review.review.highlights.map((h, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-ink-soft">
                    <span className="text-success">◆</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
            {review.review.suggestions.length > 0 && (
              <ul className="space-y-1 border-t border-line-soft pt-2">
                {review.review.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-ink-mute">
                    <span className="text-accent">✦</span>
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : review?.kind === "fallback" ? (
          <div className="space-y-2">
            <p className="text-xs text-warn">AI 暂不可用（{review.reason}），以下为规则统计结论。</p>
            {facts.length > 0 ? (
              <ul className="space-y-1">
                {facts.map((f, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-ink-soft">
                    <span className="text-ink-faint">·</span>
                    <span className="whitespace-pre-wrap">{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 text-xs text-ink-faint">暂无统计数据</p>
            )}
          </div>
        ) : (
          !genBusy && (
            <p className="py-2 text-center text-xs text-ink-faint">
              点「生成复盘」让 AI 解读该账号的交易行为（走 AI 配额，结果缓存；失败自动降级为规则统计）
            </p>
          )
        )}
      </section>
    </>
  );
}
