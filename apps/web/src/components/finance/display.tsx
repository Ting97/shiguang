"use client";

import { useState } from "react";
import { useDismiss } from "@/components/dismissable";
import { TagChip } from "@/components/tag-chip";
import { yuan } from "@/lib/finance";
import type { Tx } from "./kit";
import type { Overview } from "./kit";
import { api, zhDay } from "./kit";

export /* ---------- 子组件 ---------- */

function TxRow({ tx: t, onConfirm, onEdit, onDelete }: { tx: Tx; onConfirm?: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const d = new Date(t.occurred_at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const compactDay = `${sameYear ? "" : `${String(d.getFullYear()).slice(2)}/`}${d.getMonth() + 1}/${d.getDate()}`;
  return (
    <>
      {/* 上行：徽章 + 分类/对方/备注 + 金额；窄屏自动折行后下行是 日期+账户+操作 */}
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${t.direction === "out" ? "bg-rose-500/15 text-danger" : "bg-emerald-500/15 text-success"}`}>
        {t.direction === "out" ? "支" : "收"}
      </span>
      <span className="w-12 shrink-0 text-[11px] tabular-nums text-ink-dim" title={zhDay(t.occurred_at)}>
        {compactDay}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {t.category}
        {t.counterparty && <span className="text-xs text-ink-dim"> · {t.counterparty}</span>}
        {t.note && t.note !== t.category && <span className="text-xs text-ink-dim"> · {t.note}</span>}
      </span>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.direction === "out" ? "text-danger" : "text-success"}`}>
        {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
      </span>
      {t.account_name && (
        <span className="row-secondary hidden shrink-0 items-center gap-1 text-[11px] text-ink-dim sm:flex">
          {t.account_icon} {t.account_name}
        </span>
      )}
      <span className="row-actions hidden shrink-0 gap-1 group-hover:flex">
        {onConfirm && (
          <button onClick={onConfirm} title="确认入账" className="rounded px-1.5 py-0.5 text-xs text-warn hover:bg-soft">
            ✓
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} title="修改" className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent">
            ✏️
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="删除" className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger">
            🗑
          </button>
        )}
      </span>
    </>
  );
}

/** 记账/编辑表单（元输入，提交转分） */

/** 储蓄率趋势（近 6 个月小柱图）：rate=null 表示当月无收入无法计算 */
export function SavingsTrend({ trend }: { trend: Overview["trend"] }) {
  const max = Math.max(100, ...trend.map((t) => Math.abs(t.rate ?? 0)));
  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-mute">
        <TagChip icon="📈" label="储蓄率 · 近 6 个月" tone="emerald" />
      </p>
      <div className="flex items-end justify-between gap-2">
        {trend.map((t, i) => {
          const isCur = i === trend.length - 1;
          const h = t.rate == null ? 4 : Math.max(6, (Math.abs(t.rate) / max) * 64);
          return (
            <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span
                className={`text-[10px] tabular-nums ${
                  t.rate == null ? "text-ink-faint" : t.rate >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {t.rate == null ? "—" : `${t.rate}%`}
              </span>
              <div
                title={`${t.month}：收入 ¥${yuan(t.inCents)} · 支出 ¥${yuan(t.outCents)}`}
                className={`w-full rounded-t transition-colors ${
                  t.rate == null
                    ? "bg-elevated"
                    : t.rate >= 0
                      ? "bg-gradient-to-t from-emerald-600/50 to-emerald-400/80"
                      : "bg-gradient-to-t from-rose-600/50 to-rose-400/80"
                } ${isCur ? "ring-1 ring-sky-400/60" : ""}`}
                style={{ height: h }}
              />
              <span className={`text-[9px] tabular-nums ${isCur ? "text-ink-soft" : "text-ink-faint"}`}>
                {Number(t.month.slice(5))}月
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 预算编辑 */
export function BudgetEditor({ ov, onCancel, onSaved }: { ov: Overview; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [limit, setLimit] = useState(ov.budget.monthly_limit_cents > 0 ? String(ov.budget.monthly_limit_cents / 100) : "");
  const [threshold, setThreshold] = useState(ov.budget.alert_threshold);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-mute">月度支出上限 ¥</span>
      <input
        autoFocus
        type="number"
        min="0"
        step="1"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="0 = 不设上限"
        className="w-28 rounded border border-line-strong bg-surface px-2 py-1 tabular-nums outline-none focus:border-sky-500"
      />
      <span className="text-ink-mute">预警阈值</span>
      <select
        value={threshold}
        onChange={(e) => setThreshold(Number(e.target.value))}
        className="rounded border border-line-strong bg-surface px-1.5 py-1 outline-none"
      >
        {[50, 60, 70, 80, 90].map((t) => (
          <option key={t} value={t}>{t}%</option>
        ))}
      </select>
      <span className="ml-auto flex gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-ink-mute hover:bg-soft">取消</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const cents = limit ? Math.round(parseFloat(limit) * 100) : 0;
              await api("/api/budget", "PUT", { monthlyLimitCents: Number.isFinite(cents) ? cents : 0, alertThreshold: threshold });
              await onSaved();
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded px-4 py-1 font-medium"
        >
          保存
        </button>
      </span>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // N3：点遮罩/空白关闭由面板 useDismiss 统一处理（遮罩保留视觉）
  const ref = useDismiss<HTMLDivElement>(onClose);
  return (
    /* 移动端底部弹层（键盘不遮提交钮、拇指可达）；桌面居中卡片 */
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/70 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={ref}
        className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-ink-dim hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
