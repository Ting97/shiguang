/**
 * API CORS 策略（纯函数，供 middleware 与单测共用）
 * - 静态白名单：Capacitor 壳 origin（android http://localhost / ios capacitor://localhost）
 * - 动态放行：任何携带 Authorization（Bearer 会话）的请求回显其 origin——
 *   token 通道天然无 cookie，CSRF 无利可图；反射 origin 时绝不附带 allow-credentials
 * - 浏览器预检放行：预检（OPTIONS）按 fetch 规范不携带 Authorization，旧版 Bearer 判据
 *   对预检恒为 false → 分离部署（NEXT_PUBLIC_API_BASE 跨域）的预检必挂。预检按
 *   「静态白名单 ∪ 实际 Bearer ∪ 预检声明的 authorization/x-setup-token 请求头」放行
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
  // 浏览器预检声明的非简单请求头（小写比对；authorization 即 Bearer 会话通道，无 CSRF 面）
  const declared = (req.headers.get("access-control-request-headers") ?? "").toLowerCase();
  const tokenChannel = bearer || /authorization|x-setup-token/.test(declared);
  const allowed = STATIC_ORIGINS.has(origin) || tokenChannel;
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
        "Access-Control-Allow-Headers": "Authorization,Content-Type,x-setup-token",
        "Access-Control-Max-Age": "86400",
      },
    };
  }
  return { preflight: false, headers };
}
