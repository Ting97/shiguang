"use client";

import { useRef, useState } from "react";
import { TX_CATEGORIES, yuan } from "@/lib/finance";

interface ImportPreview {
  platform: "alipay" | "wechat";
  total: number;
  importable: number;
  batchDup: number;
  dbDup: number;
  skipped: number;
  skipSummary: Record<string, number>;
  categories: Record<string, number>;
  outCents: number;
  inCents: number;
  sample?: { occurredAt: string; direction: string; amountCents: number; category: string; counterparty: string | null }[];
}

interface Account {
  id: string;
  name: string;
  icon: string;
}

const PLATFORM_LABEL: Record<string, string> = { alipay: "🅰 支付宝", wechat: "💬 微信" };

const PLATFORM_COLOR: Record<string, string> = {
  alipay: "#1677ff",
  wechat: "#07c160",
};

/** 读文件文本：UTF-8 优先，出现替换符（典型 GBK 乱码特征）时回退 GBK 重读 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (!text.includes("\uFFFD")) return resolve(text);
      const gbkReader = new FileReader();
      gbkReader.onload = () => resolve(String(gbkReader.result ?? ""));
      gbkReader.onerror = () => reject(new Error("文件读取失败"));
      gbkReader.readAsText(file, "gbk");
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsText(file, "utf-8");
  });
}

const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

/** 账单导入弹层：文件/粘贴 → 预览（dryRun）→ 确认入账 */
export default function BillImport({
  accounts,
  onClose,
  onImported,
}: {
  accounts: Account[];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(f: File) {
    setError(null);
    try {
      const content = await readFileText(f);
      setText(content);
      setFileName(`${f.name}（${(f.size / 1024).toFixed(0)} KB）`);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doPreview() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, dryRun: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "解析失败");
      setPreview(j);
      // 按平台预选账户
      const match = accounts.find((a) =>
        j.platform === "alipay" ? a.name.includes("支付宝") : a.name.includes("微信"),
      );
      if (match) setAccountId(match.id);
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
      const r = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, accountId: accountId || null, dryRun: false }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "导入失败");
      setResult(
        j.imported > 0
          ? `✅ 已导入 ${j.imported} 笔${j.dbDup ? ` · 跳过重复 ${j.dbDup} 笔` : ""}`
          : `ℹ️ ${j.message ?? "没有新流水"}`,
      );
      setPreview(null);
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dupTotal = (preview?.batchDup ?? 0) + (preview?.dbDup ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">📥 导入支付宝/微信账单</h3>
          <button onClick={onClose} className="rounded px-2 text-ink-dim hover:text-ink">✕</button>
        </div>

        {result ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm text-success">{result}</p>
            <button onClick={onClose} className="btn-primary rounded-xl px-6 py-2 text-sm font-medium">
              完成
            </button>
          </div>
        ) : !preview ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border border-dashed border-line-strong bg-bg/40 px-4 py-6 text-center text-sm text-ink-mute transition hover:border-sky-500/60 hover:text-accent"
            >
              {fileName ? (
                <>📄 {fileName}<span className="ml-2 text-xs text-ink-dim">点击更换</span></>
              ) : (
                <>点击选择账单 CSV 文件<span className="mt-1 block text-xs text-ink-faint">支付宝 / 微信官方导出，编码自动识别</span></>
              )}
            </button>
            <details>
              <summary className="cursor-pointer text-xs text-ink-dim hover:text-ink-mute">或粘贴账单文本</summary>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                  setPreview(null);
                }}
                rows={6}
                placeholder="直接粘贴 CSV 内容（含表头行）…"
                className="mt-2 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-sky-500"
              />
            </details>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              账单来源：支付宝 App「我的 → 账单 → … → 开具交易流水」/ 网页版导出；微信「我 → 服务 → 钱包 → 账单 → 下载账单（用于个人对账）」。导入自动去重、分类，商家记入对方。
            </p>
            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
              <button
                disabled={busy || text.trim().length < 10}
                onClick={doPreview}
                className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {busy ? "解析中…" : "解析预览"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-bg/50 px-3 py-2.5">
              <span
                className="rounded px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: PLATFORM_COLOR[preview.platform] }}
              >
                {PLATFORM_LABEL[preview.platform]}
              </span>
              <span className="text-xs text-ink-mute">
                {preview.total} 笔 · 可导入 <b className="text-accent">{preview.importable}</b>
                {dupTotal > 0 && <span className="text-warn"> · 重复跳过 {dupTotal}</span>}
                {preview.skipped > 0 && <span className="text-ink-dim"> · 不可导入 {preview.skipped}</span>}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-bg/50 px-3 py-2">
                <p className="text-ink-dim">可导入支出</p>
                <p className="mt-0.5 font-semibold tabular-nums text-danger">{fmtMoney(preview.outCents)}</p>
              </div>
              <div className="rounded-lg bg-bg/50 px-3 py-2">
                <p className="text-ink-dim">可导入收入</p>
                <p className="mt-0.5 font-semibold tabular-nums text-success">{fmtMoney(preview.inCents)}</p>
              </div>
            </div>

            {/* 分类分布 */}
            {Object.keys(preview.categories).length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-mute">
                {TX_CATEGORIES.filter((c) => preview.categories[c]).map((c) => (
                  <span key={c}>{c} × {preview.categories[c]}</span>
                ))}
                {Object.entries(preview.categories)
                  .filter(([c]) => !TX_CATEGORIES.includes(c))
                  .map(([c, n]) => (
                    <span key={c}>{c} × {n}</span>
                  ))}
              </div>
            )}

            {/* 样例行 */}
            {preview.sample && preview.sample.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-line-soft bg-bg/40 p-2 text-[11px] text-ink-mute">
                {preview.sample.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`rounded px-1 text-[9px] ${s.direction === "out" ? "bg-rose-500/15 text-danger" : "bg-emerald-500/15 text-success"}`}>
                      {s.direction === "out" ? "支" : "收"}
                    </span>
                    <span className="flex-1 truncate">{s.category}{s.counterparty ? ` · ${s.counterparty}` : ""}</span>
                    <span className="shrink-0 tabular-nums">{fmtMoney(s.direction === "out" ? -s.amountCents : s.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* 记入账户 */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-ink-mute">记入账户：</span>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccountId(accountId === a.id ? "" : a.id)}
                  className={`rounded-full px-3 py-1 text-[11px] transition ${
                    accountId === a.id ? "bg-sky-600 text-white" : "bg-elevated text-ink-soft hover:bg-soft"
                  }`}
                >
                  {a.icon} {a.name}
                </button>
              ))}
              <span className="text-[10px] text-ink-faint">（不选则不记账户）</span>
            </div>

            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <div className="flex justify-between gap-2">
              <button
                onClick={() => { setPreview(null); setError(null); }}
                className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft"
              >
                ← 重新选择
              </button>
              <button
                disabled={busy || preview.importable === 0}
                onClick={doImport}
                className="btn-primary rounded-lg px-6 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {busy ? "导入中…" : `确认导入 ${preview.importable} 笔`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
