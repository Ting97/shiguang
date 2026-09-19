/** 财务模块纯函数 —— 金额一律用「分」（整数），显示层再转元 */

/** 流水分类（与动态识别的分类词保持一致） */
export const TX_CATEGORIES = ["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "医疗", "居住", "其他"];

export interface CategorySlice {
  category: string;
  cents: number;
  pct: number; // 0~100
}

/** 分类占比（支出）：按金额降序，pct 保留一位小数 */
export function categoryBreakdown(
  byCategory: Record<string, number>,
): CategorySlice[] {
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return Object.entries(byCategory)
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, cents]) => ({
      category,
      cents,
      pct: Math.round((cents / total) * 1000) / 10,
    }));
}

/** 储蓄率：(收入-支出)/收入 ×100，收入为 0 时返回 null（无法计算） */
export function savingsRate(incomeCents: number, expenseCents: number): number | null {
  if (incomeCents <= 0) return null;
  return Math.round(((incomeCents - expenseCents) / incomeCents) * 1000) / 10;
}

export type BudgetTone = "safe" | "warn" | "over" | "none";

/** 预算进度状态：>=100% 超支(红)，>=阈值 预警(黄)，未设置 none */
export function budgetTone(
  spentCents: number,
  limitCents: number,
  threshold = 80,
): { tone: BudgetTone; pct: number } {
  if (limitCents <= 0) return { tone: "none", pct: 0 };
  const pct = Math.round((spentCents / limitCents) * 1000) / 10;
  if (pct >= 100) return { tone: "over", pct };
  if (pct >= threshold) return { tone: "warn", pct };
  return { tone: "safe", pct };
}

/** 分 → 元字符串（整数元不带小数，非整保留两位） */
export function yuan(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/** 本月标识 YYYY-MM（本地时区） */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 上一个月份标识 */
export function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return monthKey(d);
}

/** 环比变化百分比：(cur-prev)/prev ×100，prev 为 0 时 null */
export function momChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
