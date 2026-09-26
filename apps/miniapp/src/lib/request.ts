/**
 * 请求层（docs/15 §2.2）：wx.request 封装，蓝本 apps/mobile/src/api.ts。
 * - 自动带 Authorization: Bearer <64hex>（登录前无 token 不带）
 * - 响应体含 token 字段自动入库（login/bind/wechat-login 三处复用）
 * - 401（中间件浅 401 无 code / 路由深 401 有 code，两形态统一）清 token 跳登录
 * - 错误统一 ApiError{status, message}
 * 上传走 upload<T>（wx.uploadFile，multipart 字段 file）。
 */
import Taro from "@tarojs/taro";
import { getSessionToken, setSessionToken, toLogin } from "./session";

export const API_BASE: string = TARO_APP_API_BASE;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** 401 时只抛错不跳登录（登录页自身用） */
  noRedirect?: boolean;
}

function postProcessToken(data: unknown) {
  // 与 client-api 同语义：任何响应带 token 即视为服务端下发的新会话
  if (data && typeof data === "object" && typeof (data as { token?: unknown }).token === "string") {
    setSessionToken((data as { token: string }).token);
  }
}

export async function request<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const token = getSessionToken();
  const header: Record<string, string> = { "Content-Type": "application/json" };
  if (token) header.Authorization = `Bearer ${token}`;

  const res = await Taro.request({
    url: `${API_BASE}${path}`,
    method: opts.method ?? "GET",
    data: opts.body as never,
    header,
    timeout: 20000,
  });
  const status = res.statusCode;
  const data = res.data as T & { error?: string; token?: string };
  if (status >= 200 && status < 300) {
    postProcessToken(data);
    return data;
  }
  if (status === 401) {
    if (!opts.noRedirect) toLogin();
    throw new ApiError(data?.error || "未登录", 401);
  }
  throw new ApiError(data?.error || `请求失败（${status}）`, status);
}

/** multipart 上传（语音 /api/asr、动态图片 /api/files）：字段名 file，与 web FormData 同构 */
export function upload<T = unknown>(path: string, filePath: string, extra?: Record<string, string>): Promise<T> {
  const token = getSessionToken();
  return new Promise((resolve, reject) => {
    Taro.uploadFile({
      url: `${API_BASE}${path}`,
      filePath,
      name: "file",
      formData: extra,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 60000,
      success: (res) => {
        let data: T & { error?: string; token?: string };
        try {
          data = JSON.parse(res.data);
        } catch {
          reject(new ApiError("响应解析失败", res.statusCode));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          postProcessToken(data);
          resolve(data);
        } else if (res.statusCode === 401) {
          toLogin();
          reject(new ApiError(data?.error || "未登录", 401));
        } else {
          reject(new ApiError(data?.error || `上传失败（${res.statusCode}）`, res.statusCode));
        }
      },
      fail: (err) => reject(new ApiError(err.errMsg || "网络异常", 0)),
    });
  });
}
