import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { createActivity, listActivities } from "@/server/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activities —— 全部分类（空则自愈播种，兜底早期注册的存量账号） */
export const GET = withAuth(async (_req, { user }) => NextResponse.json(await listActivities(user.id)));

/** POST /api/activities —— 新增自定义分类 */
export const POST = withAuth(async (req, { user }) =>
  NextResponse.json(await createActivity(user.id, await req.json().catch(() => ({})))),
);
