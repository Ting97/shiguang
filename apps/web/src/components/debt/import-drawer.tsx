"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/shared/api";
import { fmt } from "./kit";

/**
 * R2 负债导入抽屉（REQ-005 FR-2.2）：粘贴/上传 trade-export 产出的 shiguang-import.json
 * → dryRun 预览（逐行 action + 对账摘要）→ 确认写入。
 */
interface PreviewRow {
  name: string;
  type: string;
  principalCents: number;
  balanceCents?: number | null;
  monthlyCents?: number | null;
  action: "create" | "skip";
  exists: boolean;
}
interface ImportResult {
  created: number;
  skipped: number;
  accountsCreated: number;
  summary: { beforeTotalCents: number; afterTotalCents: number; newCount: number; skipCount: number };
}

export default function DebtImportDrawer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportResult["summary"] | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 导入成功的面板内提示（替代原生 alert）
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setJsonText("");
      setFileName("");
      setPreview(null);
      setRows(null);
      setSkipped(new Set());
      setErr(null);
    }
  }, [open]);

  if (!open) return null;

  async function runDry() {
    setBusy(true);
    setErr(null);
    try {
      const data = JSON.parse(jsonText);
      const j = await api<any>("/api/debts/import", "POST", { dryRun: true, data });
      setRows(j.rows ?? []);
      setSkipped(new Set((j.rows ?? []).map((r: PreviewRow, i: number) => (r.action === "skip" ? i : -1)).filter((i: number) => i >= 0)));
      setPreview(j.summary ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setErr(null);
    try {
      const data = JSON.parse(jsonText);
      // 排除预览时取消勾选的行
      data.liabilities = (data.liabilities ?? []).filter((_: unknown, i: number) => !skipped.has(i));
      const r = await api<ImportResult>("/api/debts/import", "POST", { dryRun: false, data });
      setPreview(r.summary ?? null);
      setRows(null);
      onDone();
      // 原生 alert 换面板内成功轻提示：短暂展示结果后自动关闭（阻塞式弹窗与全站交互不一致）
      setErr(null);
      setDoneMsg(`✅ 导入完成：新建 ${r.created} 笔、跳过 ${r.skipped} 笔${r.accountsCreated ? `、账户 ${r.accountsCreated} 个` : ""}`);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto rounded-l-2xl border-l border-line-soft bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">📥 从 trade 导入负债</h2>
          <button onClick={onClose} className="text-ink-mute hover:text-ink">✕</button>
        </div>

        {!rows && (
          <>
            <p className="mb-2 text-[11px] text-ink-mute">
              粘贴 <code className="rounded bg-elevated px-1">shiguang-import.json</code> 内容（由
              <code className="mx-0.5 rounded bg-elevated px-1">scripts/trade-export.mjs</code> 在 trade 服务器生成），或选择文件。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setJsonText(await f.text());
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="mb-2 rounded-lg border border-line-soft px-3 py-1.5 text-xs text-ink-mute hover:text-accent"
            >
              📄 选择 JSON 文件{fileName && `：${fileName}`}
            </button>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{"exportedAt":"…","liabilities":[…],"accounts":[…]}'
              className="h-56 w-full rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] outline-none placeholder:text-ink-faint"
            />
            <button
              onClick={() => void runDry()}
              disabled={busy || !jsonText.trim()}
              className="btn-primary mt-3 w-full rounded-xl py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "解析中…" : "解析并预览"}
            </button>
          </>
        )}

        {rows && (
          <>
            {preview && (
              <div className="mb-3 rounded-xl border border-line-soft bg-bg/40 p-3 text-[11px] text-ink-mute">
                共 {rows.length} 行：新建 <b className="text-accent">{preview.newCount}</b> · 跳过 <b>{preview.skipCount}</b>；
                总负债 {fmt(preview.beforeTotalCents)} → <b className="text-ink">{fmt(preview.afterTotalCents)}</b>
              </div>
            )}
            <ul className="mb-3 max-h-80 space-y-1.5 overflow-y-auto">
              {rows.map((r, i) => (
                <li key={i} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${r.action === "skip" ? "border-line-soft text-ink-faint" : "border-line-soft bg-bg/40"}`}>
                  <input
                    type="checkbox"
                    checked={!skipped.has(i)}
                    onChange={(e) => {
                      const n = new Set(skipped);
                      if (e.target.checked) n.delete(i);
                      else n.add(i);
                      setSkipped(n);
                    }}
                    disabled={r.action === "skip"}
                    className="size-3.5 accent-sky-500"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                  <span className="text-[10px] text-ink-faint">{r.type}</span>
                  <span className="tabular-nums text-ink-mute">{fmt(r.balanceCents ?? r.principalCents)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.action === "skip" ? "bg-elevated text-ink-faint" : "bg-sky-500/15 text-accent"}`}>
                    {r.action === "skip" ? "已存在·跳过" : "将创建"}
                  </span>
                </li>
              ))}
            </ul>
            {err && <p className="mb-2 text-[11px] text-danger">{err}</p>}
      {doneMsg && <p className="text-xs text-success">{doneMsg}</p>}
            <div className="flex gap-2">
              <button onClick={() => setRows(null)} className="flex-1 rounded-xl border border-line-soft py-2 text-sm text-ink-mute hover:text-ink">
                返回修改
              </button>
              <button
                onClick={() => void commit()}
                disabled={busy}
                className="btn-primary flex-1 rounded-xl py-2 text-sm font-medium disabled:opacity-40"
              >
                {busy ? "导入中…" : "确认导入（勾选项）"}
              </button>
            </div>
          </>
        )}

        {!rows && err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
      </div>
    </div>
  );
}
