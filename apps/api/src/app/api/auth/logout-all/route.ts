import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { logoutAll } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout-all —— 全端登出（REQ-004 FR-C1.3）：吊销该用户全部会话并清本机 cookie */
export const POST = withAuth(async (_req, { user }) => NextResponse.json(await logoutAll(user.id)));
