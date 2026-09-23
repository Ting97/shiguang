/** 负债页共享类型与工具（004 4-G 自 debt/page.tsx 拆出） */
"use client";

import { yuan } from "@/lib/finance";
import type { DebtType } from "@/lib/finance";

export const fmt = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

export const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 统一取数封装（REQ-004 FR-E1.1）：转发 @/shared/api，导出签名不变，调用方无需改动 */
export { api } from "@/shared/api";

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  principal_cents: number;
  balance_cents: number;
  rate_pct: number;
  monthly_cents: number | null;
  pay_day: number | null;
  due_date: string | null;
  priority: number;
  note: string | null;
  status: "active" | "cleared" | "archived";
  paid_cents?: number;
  payments_count?: number;
}
export interface Wall {
  id: string;
  name: string;
  type: DebtType;
  dueDate: string;
  balanceCents: number;
  monthlyCents: number | null;
  daysLeft: number;
  level: "danger" | "warn";
}
export interface Overview {
  totals: { balanceCents: number; bankCents: number; monthlyDueCents: number; weightedRatePct: number; liabilityCount: number };
  netWorthCents: number;
  assetBalanceCents: number;
  wall: Wall[];
  cashFlow: {
    monthKey: string;
    incomeCents: number;
    expenseCents: number;
    realizedCents: number;
    paidThisMonthCents: number;
    remainingDueCents: number;
    gapCents: number;
  };
  hints: string[];
}
export interface Account { id: string; name: string; icon: string; balance_cents: number }
export interface SimPack {
  strategy: string;
  order: string[];
  months: number | null;
  clearedLabel: string | null;
  totalInterestCents: number;
  totalPaidCents: number;
  interestSavedVsBaselineCents: number;
  monthsSavedVsBaseline: number | null;
  schedule: { month: string; paidCents: number; interestCents: number; balanceCents: number }[];
  notCleared: boolean;
}
export interface SimResult { baseline: SimPack; snowball: SimPack; avalanche: SimPack; startMonth: string }
