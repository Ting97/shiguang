/**
 * 负债分包页局部端点与类型（= web components/debt/kit.ts 的小程序版）。
 * lib/api.ts 的 loadDebts/loadDebtOverview/loadReserve/setReserveCheck 类型较宽（overview 是 Record<string,any>），
 * 本页要消费 totals/netWorth/wall/cashFlow/hints 全量结构，故就地重声明完整契约；
 * 新建/编辑/归档/还款/模拟/账户参与备付 lib 均未封装，按 README 约定局部补齐。
 * 契约 grep apps/api/src/app/api/debts/** 与 apps/api/src/app/api/accounts/route.ts 确认。
 */
import { request } from "@/lib/request";
import { yuan } from "@/lib/api";

/* ---------- 类型（= web debt/kit.ts） ---------- */

// REQ-009 9-C 单源化：负债类型枚举与展示元数据改从 @shiguangri/shared/finance 引入（原为同源手工拷贝）
import { DEBT_TYPES as SHARED_DEBT_TYPES, DEBT_TYPE_META as SHARED_DEBT_TYPE_META, type DebtType } from "@shiguangri/shared";
export const DEBT_TYPES: readonly DebtType[] = SHARED_DEBT_TYPES;
export const DEBT_TYPE_META: Record<DebtType, { label: string; icon: string }> = SHARED_DEBT_TYPE_META;
export type { DebtType };

/** 金额字段可能是 string（pg bigint/numeric 出参），比较前 Number() */
export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  principal_cents: number | string;
  balance_cents: number | string;
  rate_pct: number;
  monthly_cents: number | string | null;
  pay_day: number | null;
  due_date: string | null;
  priority: number;
  note: string | null;
  status: "active" | "cleared" | "archived";
  paid_cents?: number | string;
  payments_count?: number;
}
export interface WallRow {
  id: string;
  name: string;
  type: DebtType;
  dueDate: string;
  balanceCents: number;
  monthlyCents: number | null;
  daysLeft: number;
  level: "danger" | "warn";
}
export interface DebtOverview {
  totals: {
    balanceCents: number | string;
    bankCents: number | string;
    monthlyDueCents: number | string;
    weightedRatePct: number;
    liabilityCount: number;
  };
  netWorthCents: number | string;
  assetBalanceCents: number | string;
  wall: WallRow[];
  cashFlow: {
    monthKey: string;
    incomeCents: number | string;
    expenseCents: number | string;
    realizedCents: number | string;
    paidThisMonthCents: number | string;
    remainingDueCents: number | string;
    gapCents: number | string;
  };
  hints: string[];
}
/** GET /api/debts/reserve 返回（服务端按 name 合并同名负债；liabilityIds=合并组全部 id） */
export interface ReserveData {
  ym: string;
  items: {
    liabilityId: string;
    name: string;
    payDays: number[];
    pay: number;
    extra: number;
    need: number;
    checked: boolean;
    liabilityIds: string[];
  }[];
  totalNeed: number;
  checkedNeed: number;
  savingsCents: number;
  coveragePct: number | null;
}
export interface AccRow {
  id: string;
  name: string;
  icon: string;
  balanceCents: number;
  reserveTracked?: boolean;
}
export interface SimPack {
  strategy: string;
  order: string[];
  months: number | null;
  clearedLabel: string | null;
  totalInterestCents: number;
  totalPaidCents: number;
  interestSavedVsBaselineCents: number;
  monthsSavedVsBaseline: number | null;
  notCleared: boolean;
}
export interface SimResult {
  baseline: SimPack;
  snowball: SimPack;
  avalanche: SimPack;
  startMonth: string;
}

/* ---------- 端点 ---------- */

export function loadDebts() {
  // 实际返回 {debts:[...]}（serializeDebt 口径），保留 liabilities 兜底
  return request<{ debts?: Debt[]; liabilities?: Debt[] }>("/api/debts");
}
export function loadOverview() {
  return request<DebtOverview>("/api/debts/overview");
}
export function loadReserve(ym: string) {
  return request<ReserveData>(`/api/debts/reserve?ym=${ym}`);
}
/** 勾选/取消备付。坑：合并行「组内任一勾选即整组已勾」，取消须整组 liabilityIds 逐个 PUT（PUT 只收单 id） */
export function setReserveCheck(ym: string, liabilityId: string, checked: boolean) {
  return request("/api/debts/reserve", { method: "PUT", body: { ym, liabilityId, checked } });
}
/** 一键备付 / 清空 */
export function setReserveAll(ym: string, all: boolean) {
  return request("/api/debts/reserve", { method: "PUT", body: { ym, all } });
}
/** POST /api/debts —— 新建档案 {name,type,principalCents,balanceCents?,ratePct?,monthlyCents?,payDay?,dueDate?,priority?,note?} */
export function createDebt(payload: Record<string, unknown>) {
  return request("/api/debts", { method: "POST", body: payload });
}
export function updateDebt(id: string, payload: Record<string, unknown>) {
  return request(`/api/debts/${id}`, { method: "PATCH", body: payload });
}
/** DELETE = 归档（不再统计，可随时 PATCH status=active 恢复） */
export function archiveDebt(id: string) {
  return request(`/api/debts/${id}`, { method: "DELETE" });
}
/** 还款登记：amountCents 正整数分；paidAt YYYY-MM-DD；accountId 可空（选了则联动记一笔「还款」支出）。
 * 返回 {payment, debt}——debt.status==="cleared" 表示这笔还清了。同日同额重复提交 409。 */
export function payDebt(id: string, body: { amountCents: number; paidAt: string; accountId: string | null; note: string | null }) {
  return request<{ payment: unknown; debt?: { status?: string } }>(`/api/debts/${id}/payments`, { method: "POST", body });
}
/** 策略模拟：{extraMonthlyCents} → baseline/snowball/avalanche 三套推演 */
export function runSimulation(extraMonthlyCents: number) {
  return request<SimResult>("/api/debts/simulate", { method: "POST", body: { extraMonthlyCents } });
}
export function loadAccountList() {
  return request<{ accounts: AccRow[] }>("/api/accounts");
}
/** 账户参与/退出备付统计 */
export function setAccountReserve(id: string, reserveTracked: boolean) {
  return request(`/api/accounts/${id}`, { method: "PATCH", body: { reserveTracked } });
}

/* ---------- 展示工具（= web debt/kit.ts fmt + shared finance） ---------- */

/** 负数负号在前：-¥260 */
export const fmt = (cents: number | string) => {
  const n = Number(cents);
  return n < 0 ? `-¥${yuan(-n)}` : `¥${yuan(n)}`;
};

/** 北京今天 YYYY-MM-DD / 北京月 YYYY-MM（REQ-009 9-C 单源：shared/date；UTC+8 推算防每月 1 日 0-8 点落上个月） */
export { bjToday } from "@shiguangri/shared";
import { bjToday as bjTodayShared } from "@shiguangri/shared";
export const bjMonthStr = (): string => bjTodayShared().slice(0, 7);
/** 月份 ±n（UTC 构造防时区偏移） */
export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
