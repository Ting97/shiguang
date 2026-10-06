/**
 * 会话令牌（docs/15 §2.2）：wx storage 存 64hex token，key 与 web/Expo 同名。
 * 语义对齐 packages/shared client-api：响应体含 token 自动入库；401 自动清。
 */
import Taro from "@tarojs/taro";

const KEY = "shiguang_token";

export function getSessionToken(): string | null {
  try {
    return Taro.getStorageSync(KEY) || null;
  } catch {
    return null;
  }
}

export function setSessionToken(token: string) {
  try {
    Taro.setStorageSync(KEY, token);
  } catch {
    /* storage 满等异常：静默，下次登录重写 */
  }
}

export function clearSessionToken() {
  try {
    Taro.removeStorageSync(KEY);
  } catch {
    /* 已不存在 */
  }
}

/** 启动时恢复（app.ts useLaunch 调用；只读不造——无 token 即未登录） */
export function ensureSessionToken(): string | null {
  return getSessionToken();
}

/** 未登录或 401 后的统一收敛：清态 + 跳登录页（对齐 web shared/session 单点跳转） */
export function toLogin() {
  clearSessionToken();
  Taro.reLaunch({ url: "/pages/login/index" });
}

/* ---------- 游客模式（REQ-游客浏览）：无 token 只读浏览，不清除直到主动登录 ---------- */

const GUEST_KEY = "shiguang_guest";

export function isGuest(): boolean {
  try {
    return Taro.getStorageSync(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function enterGuest() {
  try {
    Taro.setStorageSync(GUEST_KEY, "1");
  } catch {
    /* storage 异常静默：本会话内存态丢失只影响下次启动 */
  }
}

/** 登录成功时清除游客标记（三处登录入口共用） */
export function exitGuest() {
  try {
    Taro.removeStorageSync(GUEST_KEY);
  } catch {
    /* 已不存在 */
  }
}
