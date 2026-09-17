import { NextRequest, NextResponse } from "next/server";

/**
 * 浅层会话门卫：无会话 cookie 时页面跳 /login、API 返回 401。
 * 深层校验（会话有效性）由各 API 的 getCurrentUser 完成——Edge 中间件不连数据库。
 */
const PUBLIC_PAGES = ["/login", "/setup"];

export function middleware(req: NextRequest) {
  if (process.env.AUTH_DISABLED === "1") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (req.cookies.has("shiguang_session")) return NextResponse.next();

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (PUBLIC_PAGES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // 反代（Caddy）后 req.nextUrl 是内部地址，跳转必须按转发头还原公网地址
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = new URL("/login", `${proto}://${host}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
