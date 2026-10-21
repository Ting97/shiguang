import { NextResponse } from "next/server";
import { assertNumericBody } from "@/server/platform/http/validate";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { createActivity, listActivities } from "@/server/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activities —— 全部分类（空则自愈播种，兜底早期注册的存量账号） */
export const GET = withModule("time", async (_req, { user }) => NextResponse.json(await listActivities(user.id)));

/** POST /api/activities —— 新增自定义分类 */
export const POST = withModule("time", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  assertNumericBody(body);
  return NextResponse.json(await createActivity(user.id, body));
});
