import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { me } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me —— 当前会话信息（含模块授权 modules）；未登录 401 */
export const GET = withAuth(async (_req, { user }) => NextResponse.json(await me(user)));
