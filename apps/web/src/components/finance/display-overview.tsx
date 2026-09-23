/** 财务页概览卡（004 4-G 自 page.tsx 拆出）：三项统计、储蓄率趋势、预算进度、分类占比 */
"use client";

import { useMemo } from "react";
import { Dismissable } from "@/components/dismissable";
import { TX_COLORS, budgetTone, categoryBreakdown, momChange, savingsRate, yuan } from "@/lib/finance";
import { type Overview, fmtMoney } from "./kit";
import { BudgetEditor, SavingsTrend } from "./display";

export function OverviewCard({
  ov,
  editingBudget,
  onEditBudget,
  onBudgetSaved,
}: {
  ov: Overview;
  editingBudget: boolean;
  onEditBudget: (editing: boolean) => void;
  onBudgetSaved: () => Promise<void>;
}) {
  const slices = useMemo(() => categoryBreakdown(ov.byCategory), [ov]);
  const budget = useMemo(
    () => budgetTone(ov.outCents, ov.budget.monthly_limit_cents, ov.budget.alert_threshold),
    [ov],
  );
  const outDelta = momChange(ov.outCents, ov.prev.outCents);
  const rate = savingsRate(ov.inCents, ov.outCents);

  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[11px] text-ink-dim">本月支出</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-danger">¥{yuan(ov.outCents)}</p>
          {outDelta != null && (
            <p className={`mt-0.5 text-[10px] tabular-nums ${outDelta > 0 ? "text-danger" : "text-success"}`}>
              较上月 {outDelta > 0 ? "+" : ""}{outDelta}%
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-ink-dim">本月收入</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-success">¥{yuan(ov.inCents)}</p>
        </div>
        <div>
          <p className="text-[11px] text-ink-dim">结余</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${ov.inCents - ov.outCents >= 0 ? "text-accent" : "text-danger"}`}>
            {fmtMoney(ov.inCents - ov.outCents)}
          </p>
          {rate != null && <p className="mt-0.5 text-[10px] text-ink-dim">储蓄率 {rate}%</p>}
        </div>
      </div>

      {/* 储蓄率趋势（近 6 个月） */}
      <SavingsTrend trend={ov.trend} />

      {/* 预算进度 */}
      <div className="mt-4 border-t border-line-soft pt-3">
        {editingBudget ? (
          <Dismissable onClose={() => onEditBudget(false)}>
            <BudgetEditor
              ov={ov}
              onCancel={() => onEditBudget(false)}
              onSaved={async () => {
                onEditBudget(false);
                await onBudgetSaved();
              }}
            />
          </Dismissable>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-ink-mute">
                {ov.budget.monthly_limit_cents > 0
                  ? `月度上限 ¥${yuan(ov.budget.monthly_limit_cents)}`
                  : "未设月度上限"}
              </span>
              <button onClick={() => onEditBudget(true)} className="text-ink-dim hover:text-accent">
                {ov.budget.monthly_limit_cents > 0 ? "调整" : "设置"}
              </button>
            </div>
            {ov.budget.monthly_limit_cents > 0 && (
              <>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      budget.tone === "over"
                        ? "bg-gradient-to-r from-rose-500 to-rose-400"
                        : budget.tone === "warn"
                          ? "bg-gradient-to-r from-amber-500 to-amber-400"
                          : "bg-gradient-to-r from-sky-500 to-indigo-400"
                    }`}
                    style={{ width: `${Math.min(budget.pct, 100)}%` }}
                  />
                </div>
                <p className={`mt-1 text-[10px] tabular-nums ${
                  budget.tone === "over" ? "text-danger" : budget.tone === "warn" ? "text-warn" : "text-ink-dim"
                }`}>
                  {budget.tone === "over"
                    ? `⚠️ 已超支 ¥${yuan(ov.outCents - ov.budget.monthly_limit_cents)}（${budget.pct}%）`
                    : budget.tone === "warn"
                      ? `⚠️ 已用 ${budget.pct}%，接近上限，注意控制`
                      : `已用 ${budget.pct}%`}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {/* 分类占比 */}
      {slices.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full">
            {slices.map((s) => (
              <div
                key={s.category}
                title={`${s.category} ${yuan(s.cents)}（${s.pct}%）`}
                style={{
                  width: `${s.pct}%`,
                  backgroundColor: TX_COLORS[s.category] ?? "#64748b",
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {slices.slice(0, 6).map((s) => (
              <span key={s.category} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                {s.category}
                <span className="tabular-nums text-ink-dim">¥{yuan(s.cents)} · {s.pct}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
