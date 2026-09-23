import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { createActivity, listActivities } from "@/server/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 路由层数值字段预检：非数值 defaultMin 过了业务层 Math.min/max 会产 NaN → int 列 500 */
function assertNumericBody(body: unknown): void {
  const b = (body ?? {}) as { defaultMin?: unknown };
  if (b.defaultMin != null && (typeof b.defaultMin !== "number" || !Number.isInteger(b.defaultMin))) {
    throw ApiError.badRequest("defaultMin 需为整数（分钟）");
  }
}

/** GET /api/activities —— 全部分类（空则自愈播种，兜底早期注册的存量账号） */
export const GET = withAuth(async (_req, { user }) => NextResponse.json(await listActivities(user.id)));

/** POST /api/activities —— 新增自定义分类 */
export const POST = withAuth(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  assertNumericBody(body);
  return NextResponse.json(await createActivity(user.id, body));
});
