/**
 * 统一错误规范（REQ-004 FR-A1.2 / 4-C）：ApiError(status, code, message)。
 * 响应体 { error, code } 与现状字段名兼容（code 为新增）。现有手写 500 收敛为分类错误。
 */
export type ApiErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "quota"
  | "upstream"
  | "locked";

import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, detail?: unknown) {
    return new ApiError(400, "invalid_input", message, detail);
  }
  static unauthorized(message = "未登录") {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "仅管理员") {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(message = "资源不存在") {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string) {
    return new ApiError(409, "conflict", message);
  }
  static quota(message: string, detail?: unknown) {
    return new ApiError(402, "quota", message, detail);
  }
  static upstream(message = "依赖不可用", detail?: unknown) {
    return new ApiError(500, "upstream", message, detail);
  }
  static locked(message: string) {
    return new ApiError(423, "locked", message);
  }
}

/** 非 ApiError 的未知错误 → 分类 500（细节只进日志，不外泄）；ZodError 统一 400 */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) {
    const detail = e.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return ApiError.badRequest(`入参不合法：${detail.join("；").slice(0, 200)}`, detail);
  }
  return ApiError.upstream("服务器内部错误", String(e).slice(0, 300));
}
