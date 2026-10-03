"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/shared/api";
import { toast } from "@/shared/ui/toast";

/** 北京日历日（n 天前）——与 kit.bjToday 同口径（UTC getter + 8h） */
const isoDaysAgo = (n: number) => new Date(Date.now() + 8 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Bitget CFD 同步抽屉（docs/16）：绑定多把只读密钥（多 CFD 账号，label 区分）→ 选密钥拉取同步。
 * 时间范围默认最近 30 天（北京日历日）。凭据只写不读（服务端仅回掩码）。
 */
interface KeyRow {
  label: string;
  apiKeyMasked: string;
  updatedAt: string;
}

export default function BitgetDrawer({ onClose, onSynced }: { onClose: () => void; onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<{ bound: boolean; keys?: KeyRow[] } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [syncLabel, setSyncLabel] = useState("");
  const [login, setLogin] = useState("");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const keys = status?.keys ?? [];

  useEffect(() => {
    api<{ bound: boolean; keys?: KeyRow[] }>("/api/trading/bitget/keys")
      .then((j) => {
        setStatus(j);
        if (j.keys?.length) setSyncLabel((cur) => cur || j.keys![0].label);
      })
      .catch((e) => toast(e instanceof Error ? e.message : "状态加载失败", "err"));
  }, []);

  async function refreshKeys() {
    const j = await api<{ bound: boolean; keys?: KeyRow[] }>("/api/trading/bitget/keys");
    setStatus(j);
    return j;
  }

  async function saveKeys() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ label: string }>("/api/trading/bitget/keys", "PUT", {
        label: keyLabel.trim(),
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase.trim(),
      });
      await refreshKeys();
      setSyncLabel(r.label);
      setApiSecret("");
      setPassphrase("");
      toast("✅ 凭据已加密保存（仅只读权限需要）");
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  }

  async function unbind(label?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/trading/bitget/keys${label ? `?label=${encodeURIComponent(label)}` : ""}`, "DELETE");
      const j = await refreshKeys();
      setSyncLabel((cur) => (label && cur === label ? j.keys?.[0]?.label ?? "" : cur));
      toast(label ? `已解绑「${label}」` : "已解绑全部密钥");
    } catch (e) {
      toast(e instanceof Error ? e.message : "解绑失败", "err");
    } finally {
      setBusy(false);
    }
  }

  async function sync(dryRun: boolean) {
    if (busy) return;
    setBusy(true);
    setSummary(null);
    try {
      const j = await api<Record<string, unknown>>("/api/trading/bitget/sync", "POST", {
        keyLabel: syncLabel || undefined,
        from,
        to,
        login: login.trim() || undefined,
        dryRun,
      });
      setSummary(j);
      if (!dryRun) {
        toast("✅ 同步完成");
        await onSynced();
      }
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "同步失败", "err");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">⚡ Bitget 同步</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-dim hover:text-ink">✕</button>
        </div>

        {/* 第一步：密钥（可绑多把——主账号/子账号各一把，备注名区分） */}
        <section className="mb-4 rounded-xl border border-line-soft bg-bg/40 p-3">
          <p className="mb-2 text-xs text-ink-soft">
            {keys.length > 0
              ? `已绑定 ${keys.length} 把密钥——每把对应一个 Bitget（子）账号；可继续添加、更新或解绑`
              : "第一步：粘贴你自己 Bitget 账户的只读 API 凭据（建议仅勾「读取」权限）。凭据加密后只属于你，他人（含管理员）不可见"}
          </p>
          {keys.length > 0 && (
            <ul className="mb-2 space-y-1">
              {keys.map((k) => (
                <li key={k.label} className="flex items-center gap-2 rounded-lg bg-bg/60 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink-soft">
                    <span className="font-medium text-ink">{k.label}</span>
                    <span className="ml-2 tabular-nums text-ink-faint">{k.apiKeyMasked}</span>
                  </span>
                  <button
                    onClick={() => setSyncLabel(k.label)}
                    className={`rounded px-2 py-0.5 text-[10px] ${syncLabel === k.label ? "bg-sky-500/15 text-sky-400" : "text-ink-dim hover:text-ink"}`}
                  >
                    {syncLabel === k.label ? "同步中" : "选用"}
                  </button>
                  <button
                    onClick={() => unbind(k.label)}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-[10px] text-danger hover:bg-rose-500/10"
                  >
                    解绑
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <input className={input} placeholder="备注名（如：主账号 / 子账号A，留空=默认）" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
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
        </section>

        {/* 第二步：同步（用选中的密钥拉取，数据落到以其备注名命名的交易账号） */}
        <section className="rounded-xl border border-line-soft bg-bg/40 p-3">
          <p className="mb-2 text-xs text-ink-soft">
            第二步：手动拉取（只读）。用「{syncLabel || "默认"}」拉取 Bitget CFD 资金流水（XAUUSD 等差价合约平仓明细）；首次同步数据量大时约需数分钟，请耐心等待
          </p>
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
          <input className={`${input} mb-2`} placeholder={`交易账号名（留空=「${syncLabel || "默认"}」）`} value={login} onChange={(e) => setLogin(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => sync(true)} disabled={busy || keys.length === 0} className="btn-ghost flex-1 rounded-lg py-1.5 text-xs disabled:opacity-40">
              预览对账
            </button>
            <button onClick={() => sync(false)} disabled={busy || keys.length === 0} className="btn-primary flex-1 rounded-lg py-1.5 text-xs disabled:opacity-40">
              {busy ? "同步中…" : "同步入库"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-ink-faint">
            按平仓单 orderId 幂等去重，重复同步不产生重复明细；开仓/平仓行自动区分，开仓时间按最近开仓配对。
          </p>
        </section>

        {summary && (
          <pre className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-bg/60 p-2 text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(summary, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
