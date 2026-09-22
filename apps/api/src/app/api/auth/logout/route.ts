import { NextResponse } from "next/server";
import { withRoute } from "@/server/platform/http/route";
import { logout } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/logout —— 退出登录（删会话 + 清 cookie） */
export const POST = withRoute(async () => NextResponse.json(await logout()));
