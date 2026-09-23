"use client";

import { useEffect, useState } from "react";
import Skeleton from "@/components/skeleton";
import { TagChip } from "@/components/tag-chip";
import { api } from "@/shared/api";
import { fmtUsd, pnlColor, type EquityData } from "./kit";

/**
 * 权益曲线（FR-1.5）：内联 SVG 折线（SavingsTrend 画法），服务端已算好峰值/回撤段。
 * viewBox 拉伸（preserveAspectRatio="none"）+ non-scaling-stroke；峰值点用 HTML 覆层避免形变。
 */
const W = 320;
const H = 120;
const PAD = 10;

export default function EquitySection({ accountId }: { accountId: string }) {
  const [data, setData] = useState<EquityData | null>(null);
  // 加载失败态：错误显式呈现 + 重试，不伪装成「暂无数据」；rev 供重试重新触发取数
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setLoadErr(null);
    api<EquityData>(`/api/trading/equity?accountId=${accountId}`)
      .then((j) => {
        if (live) setData(j);
      })
      .catch((e) => {
        if (live) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [accountId, rev]);

  function retry() {
    setLoadErr(null);
    setRev((r) => r + 1);
  }

  const pts = data?.points ?? [];
  const n = pts.length;
  const vals = pts.map((p) => p.cum);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z` : "";
  const ymIdx = new Map(pts.map((p, i) => [p.ymd, i]));
  const peakIdx = data?.peak ? ymIdx.get(data.peak.ymd) : undefined;
  const maxDd = data?.drawdowns[0];

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <p className="mb-3 flex items-center gap-2">
        <TagChip icon="📈" label="权益曲线 · 累计净盈亏" tone="emerald" />
        <span className="text-[10px] text-ink-faint">日粒度 · 峰值与回撤服务端预计算</span>
      </p>
      {!data ? (
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
      ) : n === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">暂无平仓记录</p>
      ) : (
        <>
          <div className="relative h-32">
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {min < 0 && max > 0 && (
                <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="currentColor" strokeDasharray="3 3" className="text-line-strong" vectorEffect="non-scaling-stroke" />
              )}
              {area && <path d={area} fill="url(#eqFill)" />}
              <path d={line} fill="none" stroke="#0ea5e9" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              {data.drawdowns.map((dd, k) => {
                const a = ymIdx.get(dd.startYmd);
                const b = ymIdx.get(dd.troughYmd);
                if (a == null || b == null || b <= a) return null;
                const seg = pts
                  .slice(a, b + 1)
                  .map((p, j) => `${j ? "L" : "M"}${x(a + j).toFixed(1)},${y(p.cum).toFixed(1)}`)
                  .join(" ");
                return <path key={k} d={seg} fill="none" stroke="#f43f5e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
              })}
            </svg>
            {peakIdx != null && data.peak && (
              <span
                title={`峰值 ${fmtUsd(data.peak.cum)}（${data.peak.ymd}）`}
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500 ring-2 ring-sky-400/40"
                style={{ left: `${(x(peakIdx) / W) * 100}%`, top: `${(y(data.peak.cum) / H) * 100}%` }}
              />
            )}
          </div>
          <p className="mt-2 text-center text-[9px] text-ink-faint">
            <span className="text-accent">━</span> 累计净盈亏 <span className="text-danger">━</span> 回撤段{" "}
            <span className="text-accent">●</span> 峰值
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-center">
            <div>
              <p className="text-[11px] text-ink-dim">累计净盈亏</p>
              <p className={`mt-1 text-lg font-bold tabular-nums ${pnlColor(data.totalNet)}`}>{fmtUsd(data.totalNet)}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-dim">权益峰值</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-ink">{data.peak ? fmtUsd(data.peak.cum) : "—"}</p>
              <p className="mt-0.5 text-[10px] tabular-nums text-ink-faint">{data.peak?.ymd ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-dim">最大回撤</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-danger">{maxDd ? `-${fmtUsd(maxDd.amount)}` : "—"}</p>
              <p className="mt-0.5 text-[10px] tabular-nums text-ink-faint">{maxDd ? `${maxDd.startYmd} → ${maxDd.troughYmd}` : "无回撤"}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
