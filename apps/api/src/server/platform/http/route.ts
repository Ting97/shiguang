/**
 * 路由高阶封装（REQ-004 FR-A1.1 / 4-C）：
 * withRoute   统一 try/catch → ApiError 映射 + 结构化请求日志（requestId/route/耗时/status）
 * withAuth    getCurrentUser → 注入 ctx.user（未登录统一 401）
 * withAdmin   withAuth + role 校验
 * withModule  模块授权门禁（debt/trade_review）
 * withSchema / withAuthSchema / withQuery  zod 入参校验，解析结果挂 ctx.valid
 * 迁移后路由文件只做「解析入参 → 调 service → 返回」。
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, type SessionUser } from "@/server/identity/auth";
import { getModuleUser, type ModuleKey } from "@/server/platform/modules";
import { ApiError, toApiError } from "./errors";
import { log, newRequestId, runWithRequestContext } from "./logger";

export interface RouteCtx {
  req: NextRequest;
  log: typeof log;
}

export interface AuthedCtx extends RouteCtx {
  user: SessionUser;
}

/** Next RouteContext 第二参数（params Promise；any 以兼容动态/静态两种生成类型） */
export interface NextArgs extends Record<string, unknown> {
  params: Promise<any>;
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

export function jsonError(e: unknown): NextResponse {
  const apiErr = toApiError(e);
  if (apiErr.status >= 500) {
    log.error({ status: apiErr.status, code: apiErr.code, detail: apiErr.detail }, apiErr.message);
  }
  return NextResponse.json(
    { error: apiErr.message, code: apiErr.code },
    { status: apiErr.status },
  );
}

function parseWith<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ApiError(400, "invalid_input", `入参不合法：${detail.join("；").slice(0, 200)}`, detail);
  }
  return parsed.data;
}

/** 基座：请求日志上下文（requestId 贯穿）+ 统一错误映射。所有高阶封装的底座。
 * 返回函数第二参数兼容 Next 的 RouteContext（动态路由 params Promise 直通） */
export function withRoute<C extends Record<string, unknown> = { params: Promise<any> }>(
  handler: Handler<C>,
): (req: NextRequest, arg: C & { params: Promise<any> }) => Promise<Response> {
  return async (req: NextRequest, arg) => {
    const requestId = newRequestId();
    const route = new URL(req.url).pathname;
    const startedAt = Date.now();
    const run = runWithRequestContext({ requestId, route }, () => handler(req, arg as C));
    try {
      const resp = await run;
      log.info({ status: resp.status, latencyMs: Date.now() - startedAt, method: req.method }, "req");
      return resp;
    } catch (e) {
      const resp = jsonError(e);
      log.warn({ status: resp.status, latencyMs: Date.now() - startedAt, method: req.method }, "req-failed");
      return resp;
    }
  };
}

/** 鉴权：未登录统一 401；成功注入 user */
export function withAuth(handler: Handler<AuthedCtx>): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withRoute(async (req) => {
    const user = await getCurrentUser();
    if (!user) throw ApiError.unauthorized();
    return handler(req, { req, user, log });
  });
}

/** 带动态路由参数的鉴权封装：arg = { params }。params 用 any 兼容普通 [id] 与 catch-all（string[]）两种生成类型 */
export function withAuthParams(
  handler: Handler<AuthedCtx & { params: Promise<any> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withRoute<{ params: Promise<any> }>(async (req, arg) => {
    const user = await getCurrentUser();
    if (!user) throw ApiError.unauthorized();
    return handler(req, { req, user, log, params: arg!.params });
  });
}

/** 管理员门禁 */
export function withAdmin(handler: Handler<AuthedCtx>): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withAuth(async (req, ctx) => {
    if (ctx.user.role !== "admin") throw ApiError.forbidden("仅管理员");
    return handler(req, ctx);
  });
}

/** 带动态路由参数的管理员门禁：arg = { params }。语义与 withAdmin 一致（非 admin → 403 forbidden「仅管理员」） */
export function withAdminParams(
  handler: Handler<AuthedCtx & { params: Promise<any> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withAuthParams(async (req, ctx) => {
    if (ctx.user.role !== "admin") throw ApiError.forbidden("仅管理员");
    return handler(req, ctx);
  });
}

/** 带动态路由参数的模块门禁：arg = { params }。语义与 withModule 一致（未登录 401 / 未开通 403） */
export function withModuleParams(
  module: ModuleKey,
  handler: Handler<AuthedCtx & { params: Promise<any> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withRoute<{ params: Promise<any> }>(async (req, arg) => {
    const user = await getModuleUser(module);
    if (!user) {
      const cur = await getCurrentUser();
      throw cur ? new ApiError(403, "forbidden", "未开通该模块") : ApiError.unauthorized();
    }
    return handler(req, { req, user, log, params: arg!.params });
  });
}

/** 模块授权门禁（debt / trade_review）：admin 直通，普通用户查授权 */
export function withModule(
  module: ModuleKey,
  handler: Handler<AuthedCtx>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withRoute(async (req) => {
    const user = await getModuleUser(module);
    if (!user) {
      const cur = await getCurrentUser();
      throw cur ? new ApiError(403, "forbidden", "未开通该模块") : ApiError.unauthorized();
    }
    return handler(req, { req, user, log });
  });
}

/** zod body 校验（不鉴权场景） */
export function withSchema<S extends z.ZodTypeAny>(
  schema: S,
  handler: Handler<RouteCtx & { valid: z.infer<S> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withRoute(async (req) => {
    const raw = await req.json().catch(() => ({}));
    return handler(req, { req, log, valid: parseWith(schema, raw) });
  });
}

/** 鉴权 + zod body 校验（最高频组合） */
export function withAuthSchema<S extends z.ZodTypeAny>(
  schema: S,
  handler: Handler<AuthedCtx & { valid: z.infer<S> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withAuth(async (req, ctx) => {
    const raw = await req.json().catch(() => ({}));
    return handler(req, { ...ctx, valid: parseWith(schema, raw) });
  });
}

/** 鉴权 + zod query 校验 */
export function withAuthQuery<S extends z.ZodTypeAny>(
  schema: S,
  handler: Handler<AuthedCtx & { valid: z.infer<S> }>,
): (req: NextRequest, arg: { params: Promise<any> }) => Promise<Response> {
  return withAuth(async (req, ctx) => {
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    return handler(req, { ...ctx, valid: parseWith(schema, sp) });
  });
}
