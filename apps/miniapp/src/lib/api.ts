/**
 * 端点函数全集（docs/15 §5）：契约对齐 apps/web 各页面实际调用与 apps/mobile/src/api.ts。
 * 返回类型尽量窄化；unknown 处用 any 过渡（与 Expo 端同口径，逐步收紧）。
 */
import Taro from "@tarojs/taro";
import { request, upload } from "./request";

/* ---------- 会话 ---------- */


/** 微信一键登录：服务端对未绑定 openid 自动建号（免绑手机号），始终返回 token */
export function wechatLogin(code: string, profile?: { nickname?: string }) {
  return request<{ ok: true; bound: boolean; created?: boolean; token?: string; user?: { id: string; nickname: string } }>(
    "/api/auth/wechat/login",
    { method: "POST", body: profile ? { code, profile } : { code }, noRedirect: true },
  );
}

/** 已登录账号绑定当前微信（REQ-绑定已有账户）：空壳回收静默完成；openid 被有数据的账号
 *  占用时 409（ApiError.data = WechatBindConflict，页面弹「保留哪份数据」选择） */
export function bindWechatSession(code: string) {
  return request<{ ok: true; already?: boolean }>("/api/auth/wechat/bind-session", {
    method: "POST",
    body: { code },
  });
}

/** 绑定冲突裁决（REQ-账号数据保留选择）：current=微信改绑到当前账号；wechat=本次会话切换到微信账号 */
export function resolveWechatBind(code: string, resolve: "current" | "wechat") {
  return request<{ ok: true; switched?: boolean; token?: string; user?: { id: string; nickname: string } }>(
    "/api/auth/wechat/bind-session",
    { method: "POST", body: { code, resolve } },
  );
}

/** 409 冲突响应体形状（ApiError.data 断言用；与服务端 bind-session route 对齐） */
export interface WechatBindConflict {
  code: "wechat_bind_conflict";
  owner: {
    nickname: string;
    createdAt: string | null;
    counts: {
      entries: number;
      transactions: number;
      todos: number;
      blocks: number;
      contacts: number;
      goalSpaces: number;
      spaceReflections: number;
    };
  };
  current: WechatBindConflict["owner"];
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

/** 已登录账号绑定手机号（微信一键登录建的号补绑；验证码 purpose=bind 先发 sendSmsCode） */
export function bindPhone(phone: string, smsCode: string) {
  return request<{ ok: true }>("/api/auth/phone/bind", { method: "POST", body: { phone, smsCode } });
}

/** /api/auth/me 的用户形态（fetchMe 返回值收窄用；外部组件用 @/shared/session 的 SessionUser） */
interface SessionUser {
  id: string;
  nickname: string | null;
  phone: string | null;
  phoneVerified: boolean;
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

/** GET /api/feed（服务端 listFeed 返回 {moments, total}；total 供「加载更多/计数」用） */
export function loadFeed(limit = 20, offset = 0, q = "", spaceId = "all") {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset), q, spaceId });
  return request<{ moments: FeedMoment[]; total?: number }>(`/api/feed?${p.toString()}`);
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

/* ---------- 财务（只读 + 轻操作；导入类仅 PC） ----------
 * 概览端点无 lib 封装：pages/finance/api.ts 就地重声明完整契约 loadFinOverview（lib 旧 loadOverview
 * 类型缺 prev/budget，已删）。 */

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


/** 确认待确认流水（流水不入账新口径：无账户参数） */
export function confirmTx(id: string) {
  return request(`/api/transactions/${id}`, { method: "PATCH", body: { confirm: true } });
}



/* ---------- 交易（只读，REQ-005 FR-1.8 同口径） ---------- */





/* ---------- 日程 / 待办 ----------
 * blocks range 无 lib 封装：packages/calendar/index/api.ts 与 pages/schedule/api.ts 各有局部
 * loadBlocksRange（lib 旧同名封装零调用，已删）。 */

/* ---------- 空间 / 人际 / 复盘（分包页用） ---------- */

export function loadSpaces() {
  return request<{ spaces: any[] }>("/api/spaces");
}


export function loadContacts() {
  return request<{ contacts: any[] }>("/api/contacts");
}

export function loadContactDetail(id: string) {
  return request<Record<string, any>>(`/api/contacts/${id}`);
}


/* ---------- 工具 ---------- */

// REQ-009 9-C 单源化：北京时区今日与分→元格式化改从 @shiguangri/shared 引入（config compile.include 已纳入编译）
import { bjToday, yuan as yuanFromShared } from "@shiguangri/shared";

/** 北京时区 YYYY-MM-DD（= web lib/bj-time 口径，shared/date 单源） */
export { bjToday };

export function bjMonth(): string {
  return bjToday().slice(0, 7);
}

/** 分 → 元字符串（shared/finance 单源：整元不带小数、非整两位，整数分运算防浮点误差；与 web 展示一致）。
 * 金额字段可能是 string（pg bigint 出参），先 Number 归一，无效值回 "0"（沿用旧守卫）。 */
export function yuan(cents: number | string): string {
  const n = Number(cents);
  return Number.isFinite(n) ? yuanFromShared(n) : "0";
}

export function previewImage(urls: string[], current?: string) {
  if (urls.length) Taro.previewImage({ urls, current: current ?? urls[0] });
}
