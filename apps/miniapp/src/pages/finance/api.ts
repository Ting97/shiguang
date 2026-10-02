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

/* ---------- 展示纯函数（= packages/shared/finance，小程序不引 shared 就地实现） ---------- */

/** 流水分类（与动态识别分类词一致；「还款」由负债管理/账单导入产生） */
export const TX_CATEGORIES = ["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "医疗", "居住", "还款", "其他"];

/** 分类配色（报表条/图例共用；= shared/finance TX_COLORS） */
export const TX_COLORS: Record<string, string> = {
  餐饮: "#f97316",
  交通: "#78716c",
  人情往来: "#ec4899",
  学习: "#10b981",
  购物: "#8b5cf6",
  娱乐: "#eab308",
  医疗: "#14b8a6",
  居住: "#0ea5e9",
  还款: "#6366f1",
  其他: "#64748b",
};

/** 分类占比（支出降序，pct 一位小数；总额≤0 返回空） */
export function categoryBreakdown(byCategory: Record<string, number>): { category: string; cents: number; pct: number }[] {
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return Object.entries(byCategory)
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, cents]) => ({ category, cents, pct: Math.round((cents / total) * 1000) / 10 }));
}

/** 储蓄率：(收入-支出)/收入×100，无收入返回 null */
export function savingsRate(incomeCents: number, expenseCents: number): number | null {
  if (incomeCents <= 0) return null;
  return Math.round(((incomeCents - expenseCents) / incomeCents) * 1000) / 10;
}

/** 预算状态：≥100% over / ≥阈值 warn / 否则 safe；未设上限 none */
export function budgetTone(spentCents: number, limitCents: number, threshold = 80): { tone: "safe" | "warn" | "over" | "none"; pct: number } {
  if (limitCents <= 0) return { tone: "none", pct: 0 };
  const pct = Math.round((spentCents / limitCents) * 1000) / 10;
  if (pct >= 100) return { tone: "over", pct };
  if (pct >= threshold) return { tone: "warn", pct };
  return { tone: "safe", pct };
}

/** 环比变化百分比：(cur-prev)/prev×100，prev≤0 为 null */
export function momChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** 负数负号在前（直接拼接会出现 ¥-260） */
export const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

export const pad = (n: number) => String(n).padStart(2, "0");
export const monthTitle = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
export function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** ISO → 北京墙上时间 datetime 串（YYYY-MM-DDTHH:mm；= web lib/bj-time isoToBjInput） */
export function isoToBjInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** 北京墙上时间串 → ISO（显式 +08:00 解析，防宿主时区错位；= web bjInputToIso） */
export function bjInputToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.length === 16 ? `${v}:00+08:00` : `${v}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
