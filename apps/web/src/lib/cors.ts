/**
 * API CORS 策略（纯函数，供 middleware 与单测共用）
 * - 静态白名单：Capacitor 壳 origin（android http://localhost / ios capacitor://localhost）
 * - 动态放行：任何携带 Authorization（Bearer 会话）的请求回显其 origin——
 *   token 通道天然无 cookie，CSRF 无利可图；反射 origin 时绝不附带 allow-credentials
 * - Web 同域请求：不加任何 CORS 头（零回归）
 */

/** 固定白名单：Capacitor 默认 scheme origin */
const STATIC_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

export interface CorsDecision {
  /** 是否拦截为预检响应（204，不再转发到路由） */
  preflight: boolean;
  /** 要附加的 CORS 响应头（可为空对象） */
  headers: Record<string, string>;
}

export function resolveCors(req: { method: string; headers: Headers }): CorsDecision {
  const origin = req.headers.get("origin");
  if (!origin) return { preflight: false, headers: {} };

  const bearer = /^Bearer\s+/i.test(req.headers.get("authorization") ?? "");
  const allowed = STATIC_ORIGINS.has(origin) || bearer;
  if (!allowed) return { preflight: false, headers: {} };

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
  if (req.method === "OPTIONS") {
    return {
      preflight: true,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    };
  }
  return { preflight: false, headers };
}
