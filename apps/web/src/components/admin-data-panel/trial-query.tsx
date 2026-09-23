"use client";

import { useState } from "react";
import { api } from "@/shared/api";
import type { CatalogPayload, DatasetSpec, TrialResult } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 值截断 40 字符（null → —；布尔原样；空串 → —） */
function cell(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  const t = s.length > 40 ? `${s.slice(0, 40)}…` : s;
  return t || "—";
}

/**
 * ===== 数据面 · 区块 3：在线试查（REQ-005 FR-5.2，只读）=====
 * 仅 behavior/derived 分区可选（category 置灰禁用）+ 起止日期（默认最近 7 天）+ 类别（可选）+ limit
 * → GET /api/admin/data/[key]?from&to&category&limit → {total, items} 表格预览；参数错误显示服务端 error 文案。
 */
export default function TrialQuery({ catalog }: { catalog: CatalogPayload }) {
  const selectable = catalog.datasets.filter((d) => d.partition !== "category");
  const [dsKey, setDsKey] = useState(() => selectable[0]?.key ?? "");
  const now = new Date();
  const [from, setFrom] = useState(() => fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)));
  const [to, setTo] = useState(() => fmtDate(now));
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(50);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ds: DatasetSpec | undefined = catalog.datasets.find((d) => d.key === dsKey && d.partition !== "category");

  async function run() {
    if (!ds || loading) return;
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const q = new URLSearchParams();
      if (ds.timeCol) {
        q.set("from", from);
        q.set("to", to);
      }
      if (ds.categoryCol && category.trim()) q.set("category", category.trim());
      q.set("limit", String(limit));
      setResult(await api<TrialResult>(`/api/admin/data/${ds.key}?${q.toString()}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  const cols = result?.items.length ? Object.keys(result.items[0]) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={dsKey}
          onChange={(e) => {
            setDsKey(e.target.value);
            setResult(null);
            setErr(null);
          }}
          className="rounded-lg border border-line-soft bg-surface/60 px-2 py-1.5 text-xs text-ink outline-none focus:border-sky-500"
        >
          {catalog.datasets.map((d) => (
            <option key={d.key} value={d.key} disabled={d.partition === "category"}>
              {d.name}（{d.key}）{d.partition === "category" ? " · 类别型不可试查" : ""}
            </option>
          ))}
        </select>
        {ds?.timeCol && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line-soft bg-surface/60 px-2 py-1.5 text-xs text-ink outline-none focus:border-sky-500" />
            <span className="text-[10px] text-ink-faint">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line-soft bg-surface/60 px-2 py-1.5 text-xs text-ink outline-none focus:border-sky-500" />
          </>
        )}
        {ds?.categoryCol && (
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={`类别 ${ds.categoryCol}（可空）`}
            maxLength={50}
            className="w-40 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
          />
        )}
        <label className="flex items-center gap-1 text-[11px] text-ink-dim">
          limit
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))}
            className="w-16 rounded border border-line bg-surface px-1.5 py-1 text-right tabular-nums text-ink outline-none focus:border-sky-500"
          />
        </label>
        <button
          onClick={() => void run()}
          disabled={loading || !ds}
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20 disabled:opacity-50"
        >
          {loading ? "查询中…" : "🔍 试查"}
        </button>
      </div>

      {err && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-danger">{err}</p>
      )}

      {result && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] text-ink-faint">
            共 <span className="tabular-nums text-ink-mute">{result.total}</span> 条，展示前 {result.items.length} 条
          </p>
          {result.items.length === 0 ? (
            <p className="text-[11px] text-ink-faint">该条件下暂无数据</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-xl border border-line-soft">
              <table className="w-full min-w-[560px] border-collapse text-left text-[10px]">
                <thead className="sticky top-0">
                  <tr className="bg-elevated text-ink-faint">
                    {cols.map((k) => (
                      <th key={k} className="whitespace-nowrap px-2 py-1.5 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row, i) => (
                    <tr key={String(row.id ?? i)} className="border-t border-line-soft/50">
                      {cols.map((k) => (
                        <td key={k} className="max-w-52 truncate px-2 py-1 text-ink-dim" title={cell(row[k])}>{cell(row[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
