"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/shared/api";

/** 北京日历日（n 天前）——与 kit.bjToday 同口径（UTC getter + 8h） */
const isoDaysAgo = (n: number) => new Date(Date.now() + 8 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Bitget CFD 同步抽屉（docs/16）：两步——绑定只读凭据（加密落库）→ 拉取同步（dryRun 对账 → commit）。
 * 时间范围默认最近 30 天（北京日历日）。凭据只写不读（服务端仅回掩码）。
 */
export default function BitgetDrawer({ onClose, onSynced }: { onClose: () => void; onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<{ bound: boolean; apiKeyMasked?: string } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [login, setLogin] = useState("");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api<{ bound: boolean; apiKeyMasked?: string }>("/api/trading/bitget/keys")
      .then(setStatus)
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : "状态加载失败" }));
  }, []);

  async function saveKeys() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/trading/bitget/keys", "PUT", { apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), passphrase: passphrase.trim() });
      setStatus(await api("/api/trading/bitget/keys"));
      setApiSecret("");
      setPassphrase("");
      setMsg({ ok: true, text: "✅ 凭据已加密保存（仅只读权限需要）" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/trading/bitget/keys", "DELETE");
      setStatus({ bound: false });
      setMsg({ ok: true, text: "已解绑" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "解绑失败" });
    } finally {
      setBusy(false);
    }
  }

  async function sync(dryRun: boolean) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setSummary(null);
    try {
      const j = await api<Record<string, unknown>>("/api/trading/bitget/sync", "POST", { from, to, login: login.trim() || undefined, dryRun });
      setSummary(j);
      if (!dryRun) {
        setMsg({ ok: true, text: "✅ 同步完成" });
        await onSynced();
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiClientError ? e.message : "同步失败" });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">⚡ Bitget CFD 同步</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-dim hover:text-ink">✕</button>
        </div>

        {/* 第一步：凭据 */}
        <section className="mb-4 rounded-xl border border-line-soft bg-bg/40 p-3">
          <p className="mb-2 text-xs text-ink-soft">
            {status?.bound
              ? `已绑定（${status.apiKeyMasked}）——每个拾光账号各自绑定自己的 Bitget，互不可见；可更新或解绑`
              : "第一步：粘贴你自己 Bitget 账户的只读 API 凭据（建议仅勾「读取」权限）。凭据加密后只属于你，他人（含管理员）不可见"}
          </p>
          {!status?.bound && (
            <div className="space-y-2">
              <input className={input} placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <input className={input} placeholder="Secret Key" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
              <input className={input} placeholder="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              <button
                onClick={saveKeys}
                disabled={busy || !apiKey.trim() || !apiSecret.trim() || !passphrase.trim()}
                className="btn-primary w-full rounded-lg py-1.5 text-xs disabled:opacity-40"
              >
                保存凭据
              </button>
            </div>
          )}
          {status?.bound && (
            <button onClick={unbind} disabled={busy} className="rounded-lg border border-rose-500/40 px-3 py-1 text-xs text-danger hover:bg-rose-500/10">
              解绑凭据
            </button>
          )}
        </section>

        {/* 第二步：同步 */}
        <section className="rounded-xl border border-line-soft bg-bg/40 p-3">
          <p className="mb-2 text-xs text-ink-soft">第二步：拉取资金流水（平仓盈亏/手续费/隔夜费）+ 历史订单，按平仓归组成交易名细</p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-dim">
              开始（北京）
              <input className={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-dim">
              结束
              <input className={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <input className={`${input} mb-2`} placeholder="账号备注名（留空自动 bitget-xxxx）" value={login} onChange={(e) => setLogin(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => sync(true)} disabled={busy || !status?.bound} className="btn-ghost flex-1 rounded-lg py-1.5 text-xs disabled:opacity-40">
              预览对账
            </button>
            <button onClick={() => sync(false)} disabled={busy || !status?.bound} className="btn-primary flex-1 rounded-lg py-1.5 text-xs disabled:opacity-40">
              {busy ? "同步中…" : "同步入库"}
            </button>
          </div>
          <p className="text-[10px] text-ink-faint">
            手动拉取、只读不交易；按平仓单 orderId 幂等去重，重复同步不会产生重复明细。
          </p>
        </section>

        {msg && <div className={`msg-banner mt-3 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>}

        {summary && (
          <pre className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-bg/60 p-2 text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(summary, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
