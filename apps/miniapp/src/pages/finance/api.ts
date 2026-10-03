/**
 * 财务页局部端点与纯函数（= web components/finance/kit.ts + lib/finance 展示函数的小程序版）。
 * lib/api.ts 的 loadOverview 类型缺 prev/budget（本页环比与预算条要用），故就地重声明完整契约；
 * 建/改/删流水、预算、账户管理 lib 均未封装，按 README 约定在本页目录局部补齐（不改公共文件）。
 * 契约 grep apps/api/src/app/api/{transactions,budget,accounts}/route.ts 确认。
 */
import { request } from "@/lib/request";
import { yuan } from "@/lib/api";

/* ---------- 类型（= web kit.ts Overview/Tx/Account） ---------- */

export interface FinAccount {
  id: string;
  name: string;
  icon: string;
  openingBalanceCents: number;
  balanceCents: number;
}
export interface FinTx {
  id: string;
  direction: "out" | "in";
  amount_cents: number;
  category: string;
  counterparty: string | null;
  note: string | null;
  occurred_at: string;
  is_draft: boolean;
  source: string;
  entry_id: string | null;
  account_id: string | null;
  account_name: string | null;
  account_icon: string | null;
}
export interface FinOverview {
  month: string;
  outCents: number;
  inCents: number;
  byCategory: Record<string, number>;
  prev: { outCents: number; inCents: number };
  draftCount: number;
  budget: { monthly_limit_cents: number; alert_threshold: number };
  accounts: FinAccount[];
  trend: { month: string; outCents: number; inCents: number; rate: number | null }[];
}

/* ---------- 端点 ---------- */

export function loadFinOverview(month: string) {
  return request<FinOverview>(`/api/finance/overview?month=${month}`);
}

export function loadTxs(month: string) {
  return request<{ transactions: FinTx[] }>(`/api/transactions?month=${month}`);
}

/** POST /api/transactions —— 手动记账（金额正整数分 ≤¥100 万；category 必须在 TX_CATEGORIES 内；
 * occurredAt ISO 串；note/counterparty 可空） */
export function createTx(payload: {
  direction: "out" | "in";
  amountCents: number;
  category: string;
  occurredAt: string;
  note: string | null;
  counterparty: string | null;
}) {
  return request("/api/transactions", { method: "POST", body: payload });
}

/** PATCH /api/transactions/:id —— 编辑（方向/金额/分类/对方）或 {confirm:true} 草稿转正 */
export function patchTx(
  id: string,
  payload: Partial<{
    direction: "out" | "in";
    amountCents: number;
    category: string;
    counterparty: string | null;
    confirm: boolean;
  }>,
) {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: payload });
}

export function removeTx(id: string) {
  return request(`/api/transactions/${id}`, { method: "DELETE" });
}

/** PUT /api/budget {monthlyLimitCents, alertThreshold}（0 = 不设上限；阈值 clamp 1~100） */
export function saveBudget(monthlyLimitCents: number, alertThreshold: number) {
  return request("/api/budget", { method: "PUT", body: { monthlyLimitCents, alertThreshold } });
}

export function loadAccounts() {
  return request<{ accounts: FinAccount[] }>("/api/accounts");
}
export function createAccount(payload: { name: string; icon: string; openingBalanceCents: number }) {
  return request("/api/accounts", { method: "POST", body: payload });
}
export function patchAccount(id: string, payload: { name?: string; icon?: string; openingBalanceCents?: number }) {
  return request(`/api/accounts/${id}`, { method: "PATCH", body: payload });
}
export function deleteAccount(id: string) {
  return request(`/api/accounts/${id}`, { method: "DELETE" });
}

/* ---------- 展示纯函数（REQ-009 9-C 单源化：原为 packages/shared/finance 的手工拷贝 + web lib/bj-time 墙上时间，现全部改 re-export） ---------- */

export {
  TX_CATEGORIES,
  TX_COLORS,
  categoryBreakdown,
  savingsRate,
  budgetTone,
  momChange,
  isoToBjInput,
  bjInputToIso,
} from "@shiguangri/shared";

/** 负数负号在前（直接拼接会出现 ¥-260） */
export const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

export const pad = (n: number) => String(n).padStart(2, "0");
export const monthTitle = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
export function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
