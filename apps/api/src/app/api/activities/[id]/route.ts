import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertNumericBody, assertTextIdParam } from "@/server/platform/http/validate";
import { deleteActivity, updateActivity } from "@/server/time";

export const runtime = "nodejs";

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长）。
 * 注意：activities.id 是 text 列、预设分类本就是非 uuid（'sleep'…），不能做 isUuid 预检
 * （与 service.ts blocks 创建路径同口径），非法 id 查空自然 404。 */
export const PATCH = withModuleParams("time", async (req, { user, params }) => {
  const { id } = await params;
  assertTextIdParam(id, "id");
  const body = await readJsonCapped(req) as any;
  assertNumericBody(body);
  return NextResponse.json(await updateActivity(user.id, id, body));
});

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export const DELETE = withModuleParams("time", async (_req, { user, params }) => {
  const { id } = await params;
  assertTextIdParam(id, "id");
  return NextResponse.json(await deleteActivity(user.id, id));
});
