import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** PATCH /api/fitness/plans/[id] —— 确认/编辑草稿/skipped/打卡（done|partial + actual）；readJsonCapped 替代裸 req.json() */
export const PATCH = withModuleParams("fitness", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.updatePlan(ctx.user.id, String(id), body));
});

/** DELETE /api/fitness/plans/[id] —— 删除计划（REQ-021，任意状态）：
 * 联动今日行动级联清理；已打卡执行记录保留为独立历史（plan_id 置空） */
export const DELETE = withModuleParams("fitness", async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await fitnessService.deletePlan(ctx.user.id, String(id)));
});
