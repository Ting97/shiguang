import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertNumericBody, assertUuidParam } from "@/server/platform/http/validate";
import { deleteActivity, updateActivity } from "@/server/time";

export const runtime = "nodejs";

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长） */
export const PATCH = withModuleParams("time", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = await readJsonCapped(req) as any;
  assertNumericBody(body);
  return NextResponse.json(await updateActivity(user.id, id, body));
});

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export const DELETE = withModuleParams("time", async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await deleteActivity(user.id, id));
});
