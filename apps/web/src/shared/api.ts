"use client";

/**
 * Web 数据层唯一入口（REQ-004 FR-E1.1/E1.2 收口）：
 * - 转发三端共享 client-api 的 api()/apiForm()，行为与旧裸 fetch 完全兼容（同域 cookie）
 * - 401 单点跳转：会话失效统一回 /login（登录/初始化页除外——其自身调用 401 是正常业务语义）
 * - 调用方按状态码分支时捕获 ApiClientError 检查 e.status（如 409 冲突）
 */
import { api as baseApi, apiForm as baseApiForm, ApiClientError } from "@shiguangri/shared/client-api";

const NO_REDIRECT_PATHS = ["/login", "/setup"];

async function with401Redirect<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (
      e instanceof ApiClientError &&
      e.status === 401 &&
      typeof window !== "undefined" &&
      !NO_REDIRECT_PATHS.includes(window.location.pathname)
    ) {
      window.location.href = "/login";
    }
    throw e;
  }
}

export function api<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  return with401Redirect(() => baseApi<T>(url, method, body));
}

export function apiForm<T = any>(url: string, form: FormData, method = "POST"): Promise<T> {
  return with401Redirect(() => baseApiForm<T>(url, form, method));
}

export { ApiClientError };
