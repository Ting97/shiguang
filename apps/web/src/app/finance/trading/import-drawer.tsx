"use client";

import { useRef, useState } from "react";
import { MT5_TZ_LABEL, parseMt5File, type Mt5Source, type TradeRow } from "@/lib/mt5-parse";
import { api } from "@/shared/api";
import { useDismiss } from "@/components/dismissable";
import { TagChip } from "@/components/tag-chip";
import { bjTime, fmtUsd, pnlColor, type DryRunPreview } from "./kit";

/**
 * R1 交易报表导入抽屉（REQ-005 §3.3，bill-import 范式）：
 * 选文件 → 客户端解析（login 缺失时手填）→ dryRun 预览（总/新/重复/首末时间）→ 确认入库。
 * 仅 PC 渲染（FR-1.8，入口由 page.tsx 的 matchMedia 门禁控制）。
 */
export default function TradingImportDrawer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [rawName, setRawName] = useState("");
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ login: string | null; rows: TradeRow[]; source: Mt5Source } | null>(null);
  const [login, setLogin] = useState("");
  const [nickname, setNickname] = useState("");
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const ref = useDismiss<HTMLDivElement>(onClose);
  const fileRef = useRef<HTMLInputElement>(null);

  function body() {
    return {
      dryRun: true,
      login: login.trim(),
      nickname: nickname.trim() || undefined,
      fileName: rawName || "import",
      source: parsed?.source,
      rows: parsed?.rows,
    };
  }

  async function pickFile(f: File) {
    setError(null);
    setPreview(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await parseMt5File(f);
      setParsed({ login: r.login, rows: r.rows, source: r.source });
      setLogin(r.login ?? "");
      setRawName(f.name);
      setFileLabel(`${f.name}（${(f.size / 1024).toFixed(0)} KB · ${r.rows.length} 笔平仓）`);
    } catch (e) {
      setParsed(null);
      setFileLabel(null);
      setRawName("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    if (!parsed || !login.trim()) return;
    setError(null);
    setBusy(true);
    try {
      setPreview(await api<DryRunPreview>("/api/trading/import", "POST", { ...body(), dryRun: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const j = await api<{ rowsNew: number; rowsDup: number }>("/api/trading/import", "POST", { ...body(), dryRun: false });
      setResult(`✅ 已导入 ${j.rowsNew} 笔${j.rowsDup ? ` · 跳过重复 ${j.rowsDup} 笔` : ""}`);
      setPreview(null);
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={ref} className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <TagChip icon="📥" label="导入 MT5 交易报表" tone="sky" className="text-sm" />
          <button onClick={onClose} aria-label="关闭" className="rounded px-2 text-ink-dim hover:text-ink">✕</button>
        </div>

        {result ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm text-success">{result}</p>
            <button onClick={onClose} className="btn-primary rounded-xl px-6 py-2 text-sm font-medium">完成</button>
          </div>
        ) : !parsed ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,.txt,.tsv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full rounded-xl border border-dashed border-line-strong bg-bg/40 px-4 py-6 text-center text-sm text-ink-mute transition hover:border-sky-500/60 hover:text-accent disabled:opacity-40"
            >
              {busy ? (
                "解析中…"
              ) : fileLabel ? (
                <span className="inline-flex max-w-full items-center gap-1">
                  <TagChip icon="📄" label={fileLabel} tone="slate" className="max-w-[70%]" />
                  <span className="text-xs text-ink-dim">点击更换</span>
                </span>
              ) : (
                <>
                  点击选择 MT5 报表文件
                  <span className="mt-1 block text-xs text-ink-faint">
                    ReportHistory-&lt;账号&gt;.xlsx 或同列结构 CSV（≤10MB）
                  </span>
                </>
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              MT5 行情客户端 → 账户历史 → 右键「报表」导出；解析在本机完成，取「持仓」区块的平仓记录。
              时间口径：{MT5_TZ_LABEL}（夏令时为 UTC+2，导入前请确认）。
            </p>
            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}
          </div>
        ) : !preview ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-bg/50 px-3 py-2.5 text-xs text-ink-mute">
              <TagChip icon="📄" label={rawName} tone="slate" className="max-w-[60%]" />
              <span>
                解析到 <b className="text-accent">{parsed.rows.length}</b> 笔平仓 ·{" "}
                {parsed.source === "mt5_xlsx" ? "xlsx 报表" : "CSV"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-ink-mute">
                账号 Login
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="从文件名识别失败，请手填"
                  className="w-32 rounded-lg border border-line-strong bg-surface px-2 py-1 tabular-nums outline-none focus:border-sky-500"
                />
              </label>
              <label className="flex items-center gap-1.5 text-ink-mute">
                备注名（可选）
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="如 主账户"
                  className="w-28 rounded-lg border border-line-strong bg-surface px-2 py-1 outline-none focus:border-sky-500"
                />
              </label>
            </div>
            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-between gap-2">
              <button
                onClick={() => { setParsed(null); setFileLabel(null); setRawName(""); setError(null); }}
                className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft"
              >
                ← 重新选择
              </button>
              <button
                disabled={busy || !login.trim()}
                onClick={doPreview}
                className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {busy ? "查重中…" : "去重预览"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-bg/50 px-3 py-2.5 text-xs text-ink-mute">
              <TagChip icon="🔑" label={login} tone="sky" />
              <span>
                共 {preview.rowsTotal} 笔 · 新增 <b className="text-accent">{preview.rowsNew}</b>
                {preview.rowsDup > 0 && <span className="text-warn"> · 重复跳过 {preview.rowsDup}</span>}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-bg/50 px-3 py-2">
                <p className="text-ink-dim">首笔平仓（北京）</p>
                <p className="mt-0.5 font-semibold tabular-nums text-ink">{preview.firstAt ? bjTime(preview.firstAt) : "—"}</p>
              </div>
              <div className="rounded-lg bg-bg/50 px-3 py-2">
                <p className="text-ink-dim">末笔平仓（北京）</p>
                <p className="mt-0.5 font-semibold tabular-nums text-ink">{preview.lastAt ? bjTime(preview.lastAt) : "—"}</p>
              </div>
            </div>
            {preview.sample.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-line-soft bg-bg/40 p-2 text-[11px] text-ink-mute">
                {preview.sample.map((s) => (
                  <li key={s.ticket} className="flex items-center gap-2">
                    <span className={`rounded px-1 text-[9px] ${s.direction === "buy" ? "bg-sky-500/15 text-accent" : "bg-violet-500/15 text-ai"}`}>
                      {s.direction === "buy" ? "买" : "卖"}
                    </span>
                    <span className="flex-1 truncate tabular-nums">#{s.ticket} · {s.lots} 手 · {bjTime(s.closeTime)}</span>
                    <span className={`shrink-0 tabular-nums font-medium ${pnlColor(s.profit)}`}>{fmtUsd(s.profit)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-ink-faint">{MT5_TZ_LABEL}；重复以「账号 + Ticket」判重，可放心重复导入。</p>
            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-between gap-2">
              <button onClick={() => setPreview(null)} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">
                ← 返回修改
              </button>
              <button
                disabled={busy || preview.rowsNew === 0}
                onClick={doImport}
                className="btn-primary rounded-lg px-6 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {busy ? "导入中…" : `确认入库 ${preview.rowsNew} 笔`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
