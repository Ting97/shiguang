/**
 * 结构化日志（REQ-004 FR-G1.1）——零依赖 pino 等价轻量实现（单机部署，JSON 到 stdout）。
 * - AsyncLocalStorage 贯穿 requestId：withRoute（4-C）生成并注入，AI 调用/审计同链路
 * - 用法：log.info({ route, status }, "req done")；字段展开进 JSON 顶层
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  userId?: string;
  route?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function requestContext(): RequestContext | undefined {
  return als.getStore();
}

/** 现有会话/路由代码取当前请求 id（无请求上下文时返回 null） */
export function currentRequestId(): string | null {
  return als.getStore()?.requestId ?? null;
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const ctx = als.getStore();
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    requestId: ctx?.requestId,
    userId: ctx?.userId,
    route: ctx?.route,
    ...fields,
  };
  const out = JSON.stringify(line, (_k, v) => (typeof v === "bigint" ? String(v) : v === undefined ? null : v));
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  debug: (fields: Record<string, unknown> | string, msg?: string) =>
    typeof fields === "string" ? emit("debug", fields) : emit("debug", msg ?? "", fields),
  info: (fields: Record<string, unknown> | string, msg?: string) =>
    typeof fields === "string" ? emit("info", fields) : emit("info", msg ?? "", fields),
  warn: (fields: Record<string, unknown> | string, msg?: string) =>
    typeof fields === "string" ? emit("warn", fields) : emit("warn", msg ?? "", fields),
  error: (fields: Record<string, unknown> | string, msg?: string) =>
    typeof fields === "string" ? emit("error", fields) : emit("error", msg ?? "", fields),
};

/** 生成请求 id：可读前缀 + 随机（无需 crypto 级别，用于日志串联） */
export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
