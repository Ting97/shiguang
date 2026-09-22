import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { deleteActivity, updateActivity } from "@/server/time";

export const runtime = "nodejs";

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长） */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await updateActivity(user.id, id, await req.json().catch(() => ({}))));
});

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await deleteActivity(user.id, id));
});
