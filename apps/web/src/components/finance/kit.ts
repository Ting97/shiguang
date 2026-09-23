/** 财务页共享类型与工具（004 4-G 自 page.tsx 拆出） */
"use client";

import { bjToday } from "@/lib/date";
import { yuan } from "@/lib/finance";
import { isoToBjInput } from "@/lib/bj-time";

export interface Account {
  id: string;
  name: string;
  icon: string;
  openingBalanceCents: number;
  balanceCents: number;
}
export interface Tx {
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
export interface Overview {
  month: string;
  outCents: number;
  inCents: number;
  byCategory: Record<string, number>;
  prev: { outCents: number; inCents: number };
  draftCount: number;
  budget: { monthly_limit_cents: number; alert_threshold: number };
  accounts: Account[];
  trend: { month: string; outCents: number; inCents: number; rate: number | null }[];
}

export const pad = (n: number) => String(n).padStart(2, "0");
/** 北京日历日序号（UTC+8 推算，禁本地 getter：海外设备的日界会错 8 小时；参照 contacts/[id]/detail.tsx） */
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);
export const zhDay = (iso: string) => {
  const t = Date.parse(iso);
  const diff = bjDayIdx(Date.now()) - bjDayIdx(t);
  const d = new Date(t + 8 * 3600_000);
  const label = diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return `${label} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
export const monthTitle = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
/** 负数放负号在前：-¥260（直接拼接会出现 ¥-260） */
export const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);
export function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const nowMonth = () => bjToday().slice(0, 7); // 北京月：服务端按北京月分组，本地 getter 在海外设备会跨月错位


/** 统一取数封装（REQ-004 FR-E1.1）：转发 @/shared/api，导出签名不变，调用方无需改动 */
export { api } from "@/shared/api";



/** 北京墙上时间口径（lib/bj-time 单源）：本地 getter 版在海外设备上编辑框与列表展示错位 */
export function toLocalInput(iso: string): string {
  return isoToBjInput(iso);
}

