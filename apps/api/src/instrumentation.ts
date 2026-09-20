/**
 * Next.js instrumentation：未捕获错误统一落 journald（stderr）。
 * 已被路由 try/catch 的 500 会经 Caddy 访问日志留痕（status 500 + 耗时），
 * 这里兜底记录"没有 catch 的"那些，附请求方法/路径与完整堆栈。
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  console.error(
    `[api-error] ${request.method} ${request.path}`,
    err instanceof Error ? err.stack : err,
  );
};
