import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken } from "@shiguangri/shared/bearer";
import { resolveCors } from "@shiguangri/shared/cors";

/**
 * 浅层会话门卫：无会话凭证时页面跳 /login、API 返回 401。
 * 凭证两种：cookie shiguang_session（Web 同域）或 Authorization: Bearer（原生端，
 * 格式合法即放行，有效性由各 API 的 getCurrentUser 深层校验——Edge 中间件不连数据库）。
 * CORS 策略见 lib/cors.ts：预检 204、白名单/Bearer origin 回显。
 */
const PUBLIC_PAGES = ["/login", "/setup"];

export function middleware(req: NextRequest) {
  // CORS 处理独立于鉴权开关：本地 AUTH_DISABLED 跨域联调也需要响应头
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api")) {
    const cors = resolveCors(req);
    if (cors.preflight) {
      return new NextResponse(null, { status: 204, headers: cors.headers });
    }
    if (process.env.AUTH_DISABLED === "1") {
      const resp = NextResponse.next();
      for (const [k, v] of Object.entries(cors.headers)) resp.headers.set(k, v);
      // 本地联调：反射任意 origin（仅 AUTH_DISABLED 开发模式）
      const o = req.headers.get("origin");
      if (o && !cors.headers["Access-Control-Allow-Origin"]) {
        resp.headers.set("Access-Control-Allow-Origin", o);
        resp.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        resp.headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
      }
      return resp;
    }
    const bearer = extractBearerToken(req.headers.get("authorization"));
    const pass =
      bearer !== null ||
      pathname.startsWith("/api/auth") ||
      req.cookies.has("shiguang_session");
    const resp = pass ? NextResponse.next() : NextResponse.json({ error: "未登录" }, { status: 401 });
    for (const [k, v] of Object.entries(cors.headers)) resp.headers.set(k, v);
    return resp;
  }

  if (process.env.AUTH_DISABLED === "1") return NextResponse.next();

  if (PUBLIC_PAGES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.has("shiguang_session")) return NextResponse.next();

  // 反代（Caddy）后 req.nextUrl 是内部地址，跳转必须按转发头还原公网地址
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = new URL("/login", `${proto}://${host}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
