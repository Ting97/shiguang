/**
 * 端点函数全集（docs/15 §5）：契约对齐 apps/web 各页面实际调用与 apps/mobile/src/api.ts。
 * 返回类型尽量窄化；unknown 处用 any 过渡（与 Expo 端同口径，逐步收紧）。
 */
import Taro from "@tarojs/taro";
import { request, upload } from "./request";

/* ---------- 会话 ---------- */

export interface SessionUser {
  id: string;
  nickname: string | null;
  isAdmin?: boolean;
  modules?: string[];
  phoneVerified?: boolean;
}

/** 微信一键登录：bound=false 时返回 bindTicket 走绑定页 */
export function wechatLogin(code: string) {
  return request<{ ok: true; bound: boolean; token?: string; bindTicket?: string; expiresIn?: number; user?: { id: string; nickname: string } }>(
    "/api/auth/wechat/login",
    { method: "POST", body: { code }, noRedirect: true },
  );
}

/** 微信绑定手机号（bindTicket + 短信验证码） */
export function wechatBind(bindTicket: string, phone: string, smsCode: string) {
  return request<{ ok: true; token: string; user: { id: string; nickname: string } }>(
    "/api/auth/wechat/bind",
    { method: "POST", body: { bindTicket, phone, smsCode }, noRedirect: true },
  );
}

/** 发短信验证码（绑定页 purpose=bind；未配置通道 503） */
export function sendSmsCode(phone: string, purpose: "login" | "bind" = "bind") {
  return request<{ ok: true }>("/api/auth/sms/send", { method: "POST", body: { phone, purpose }, noRedirect: true });
}

/** 手机号+密码登录（兜底） */
export function passwordLogin(phone: string, password: string) {
  return request<{ ok: true; token: string; user: { id: string; nickname: string } }>("/api/auth/login", {
    method: "POST",
    body: { phone, password },
    noRedirect: true,
  });
}

export function logout() {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function fetchMe() {
  return request<SessionUser & { isAdmin: boolean; modules: string[] }>("/api/auth/me");
}

/* ---------- 动态 ---------- */

export interface FeedMoment {
  id: string;
  raw_text: string;
  created_at: string;
  mood?: string | null;
  space_id?: string | null;
  /** feed 产物为 camelCase 且 images 是 {storageKey} 对象——页面侧按真实结构收窄 */
  images?: unknown[];
  todos?: unknown[];
  transactions?: unknown[];
  blocks?: unknown[];
  interactions?: unknown[];
  [k: string]: unknown;
}

export function loadFeed(limit = 20, offset = 0, q = "", spaceId = "all") {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset), q, spaceId });
  return request<{ moments: FeedMoment[] }>(`/api/feed?${p.toString()}`);
}

export function parseText(text: string) {
  return request<{ entry: { id: string } }>("/api/parse", { method: "POST", body: { text } });
}

export function transcribeAudio(filePath: string) {
  return upload<{ text: string }>("/api/asr", filePath);
}

export function deleteEntry(id: string) {
  return request<{ ok: true }>(`/api/feed/${id}`, { method: "DELETE" });
}

/* ---------- 财务（只读 + 轻操作；导入类仅 PC） ---------- */

export interface Overview {
  month: string;
  outCents: number;
  inCents: number;
  byCategory: Record<string, number>;
  draftCount: number;
  accounts: { id: string; name: string; icon: string; balanceCents: number | string; reserveTracked: boolean }[];
  trend: { month: string; outCents: number; inCents: number; rate: number | null }[];
  budget?: { monthly_limit_cents: number; alert_threshold: number };
}

export function loadOverview(month: string) {
  return request<Overview>(`/api/finance/overview?month=${month}`);
}

export interface Tx {
  id: string;
  direction: "out" | "in";
  amount_cents: number | string;
  category: string;
  counterparty?: string | null;
  note?: string | null;
  occurred_at: string;
  is_draft: boolean;
  account_name?: string | null;
  account_icon?: string | null;
}

export function loadTransactions(month: string) {
  return request<{ transactions: Tx[] }>(`/api/transactions?month=${month}`);
}

/** 确认待确认流水（流水不入账新口径：无账户参数） */
export function confirmTx(id: string) {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: { confirm: true } });
}

export interface DebtRow {
  id: string;
  name: string;
  type: string;
  status: string;
  balance_cents: number | string;
  monthly_cents: number | string | null;
  pay_day?: number | null;
  due_date?: string | null;
  [k: string]: unknown;
}

export function loadDebts() {
  // 实际返回 {debts:[...]}（serializeDebt 口径）；分包负债页有 debts ?? liabilities 双兜底
  return request<{ debts?: DebtRow[]; liabilities?: DebtRow[] }>("/api/debts");
}

export function loadDebtOverview() {
  return request<Record<string, any>>("/api/debts/overview");
}

export function loadReserve(ym: string) {
  return request<{ ym: string; items: { name: string; need: number; pay: number; extra: number; checked: boolean }[]; totalNeed: number; checkedNeed: number; savingsCents: number; coveragePct: number | null }>(
    `/api/debts/reserve?ym=${ym}`,
  );
}

export function setReserveCheck(ym: string, liabilityId: string, checked: boolean) {
  return request("/api/debts/reserve", { method: "PUT", body: { ym, liabilityId, checked } });
}

/* ---------- 交易（只读，REQ-005 FR-1.8 同口径） ---------- */

export function loadTradingAccounts() {
  return request<{ accounts: any[] }>("/api/trading/accounts");
}

export function loadTradingDaily(accountId: string, from: string, to: string) {
  return request<{ days: any[] }>(`/api/trading/daily?accountId=${accountId}&from=${from}&to=${to}`);
}

export function loadTradingEquity(accountId: string) {
  return request<{ points: any[] }>(`/api/trading/equity?accountId=${accountId}`);
}

export function loadTradingTrades(accountId: string, page = 1) {
  return request<{ trades: any[]; total?: number }>(`/api/trading/trades?accountId=${accountId}&page=${page}`);
}

export function loadTradingReview(accountId: string) {
  return request<{ review?: string; digest?: unknown; fallback?: boolean }>(`/api/trading/review?accountId=${accountId}`);
}

/* ---------- 日程 / 待办 ---------- */

export function loadTodayActions() {
  return request<{ actions: any[] }>("/api/stats/today-actions").catch(() => ({ actions: [] }));
}

export function loadTodos() {
  return request<{ todos: any[] }>("/api/todos");
}

export function toggleTodo(id: string, done: boolean) {
  return request(`/api/todos/${id}`, { method: "PATCH", body: { done } });
}

export function loadBlocksRange(from: string, to: string) {
  return request<{ blocks: any[] }>(`/api/blocks/range?from=${from}&to=${to}`);
}

/* ---------- 空间 / 人际 / 复盘（分包页用） ---------- */

export function loadSpaces() {
  return request<{ spaces: any[] }>("/api/spaces");
}

export function loadSpaceDetail(id: string) {
  return request<Record<string, any>>(`/api/spaces/${id}`);
}

export function loadSpaceReflections(id: string) {
  // 实际返回 {items:[{id,preview,chars,created_at,...}], total}
  return request<{ items: any[]; total?: number }>(`/api/spaces/${id}/reflections`);
}

export function loadContacts() {
  return request<{ contacts: any[] }>("/api/contacts");
}

export function loadContactDetail(id: string) {
  return request<Record<string, any>>(`/api/contacts/${id}`);
}

export function loadMonthReview(month: string) {
  return request<Record<string, any>>(`/api/review?month=${month}`).catch(() => ({}));
}

/* ---------- 工具 ---------- */

/** 北京时区 YYYY-MM-DD（对齐 web lib/bj-time 口径：UTC getter + 8h） */
export function bjToday(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export function bjMonth(): string {
  return bjToday().slice(0, 7);
}

/** 分 → 元字符串（整数分运算防浮点误差，对齐 shared/finance.yuan） */
export function yuan(cents: number | string): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "0";
  return (n / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function previewImage(urls: string[], current?: string) {
  if (urls.length) Taro.previewImage({ urls, current: current ?? urls[0] });
}
