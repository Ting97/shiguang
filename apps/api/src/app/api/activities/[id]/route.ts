import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { deleteActivity, updateActivity } from "@/server/time";

export const runtime = "nodejs";

/** 路由层数值字段预检：非数值 defaultMin 过了业务层 Math.min/max 会产 NaN → int 列 500 */
function assertNumericBody(body: unknown): void {
  const b = (body ?? {}) as { defaultMin?: unknown };
  if (b.defaultMin != null && (typeof b.defaultMin !== "number" || !Number.isInteger(b.defaultMin))) {
    throw ApiError.badRequest("defaultMin 需为整数（分钟）");
  }
}

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长） */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  assertNumericBody(body);
  return NextResponse.json(await updateActivity(user.id, id, body));
});

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await deleteActivity(user.id, id));
});
