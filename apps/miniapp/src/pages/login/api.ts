/**
 * 登录页局部端点（lib/api.ts 未覆盖的部分，铁律 1：lib 只 import 不改）：
 * - 账号支持邮箱（含 @ 自动识别）——lib 的 passwordLogin 只收手机号，这里按 web
 *   app/login/page.tsx 的双形态 body 对齐（email/phone、emailCode/smsCode）。
 * - 邮箱验证码 /api/auth/email/send：服务端同源可用，与短信通道并存。
 * 全部 noRedirect：登录页自身 401 只展示错误，不触发全局跳转。
 */
import { request } from "@/lib/request";

export interface LoginResult {
  ok: true;
  token: string;
  user: { id: string; nickname: string };
}

/** 含 @ 视为邮箱（= web account.includes("@") 口径） */
export const isEmailAccount = (account: string) => account.includes("@");

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^1[3-9]\d{9}$/;

/** POST /api/auth/login 密码形态 */
export function loginWithPassword(account: string, password: string) {
  const email = isEmailAccount(account);
  return request<LoginResult>("/api/auth/login", {
    method: "POST",
    noRedirect: true,
    body: email ? { email: account, password } : { phone: account, password },
  });
}

/** POST /api/auth/login 验证码形态（email→emailCode / phone→smsCode，与 web 同字段） */
export function loginWithCode(account: string, code: string) {
  const email = isEmailAccount(account);
  return request<LoginResult>("/api/auth/login", {
    method: "POST",
    noRedirect: true,
    body: email ? { email: account, emailCode: code } : { phone: account, smsCode: code },
  });
}

/** 发登录验证码：邮箱走 /api/auth/email/send，手机号走 /api/auth/sms/send（purpose=login） */
export function sendLoginCode(account: string) {
  const email = isEmailAccount(account);
  return request<{ ok: true }>(email ? "/api/auth/email/send" : "/api/auth/sms/send", {
    method: "POST",
    noRedirect: true,
    body: email ? { email: account, purpose: "login" } : { phone: account, purpose: "login" },
  });
}
