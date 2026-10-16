import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** PATCH /api/fitness/plans/[id] —— 确认/编辑草稿/skipped/打卡（done|partial + actual） */
export const PATCH = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.updatePlan(ctx.user.id, String(id), body));
});

/** DELETE /api/fitness/plans/[id] —— 删除计划（REQ-021，任意状态）：
 * 联动今日行动级联清理；已打卡执行记录保留为独立历史（plan_id 置空） */
export const DELETE = withAuthParams(async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await fitnessService.deletePlan(ctx.user.id, String(id)));
});
