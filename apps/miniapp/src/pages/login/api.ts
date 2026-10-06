/**
 * 登录页局部端点（lib/api.ts 未覆盖的部分，铁律 1：lib 只 import 不改）：
 * - 账号支持邮箱（含 @ 自动识别）——lib 的 passwordLogin 只收手机号，这里按 web
 *   app/login/page.tsx 的双形态 body 对齐（email/phone）。
 * 验证码登录入口已移除（REQ-登录简化），loginWithCode/sendLoginCode 一并删除；
 * bind 页的短信绑定走自己的局部 api（purpose=bind，与登录无关）。
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
