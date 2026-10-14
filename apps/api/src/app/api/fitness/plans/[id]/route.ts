import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** PATCH /api/fitness/plans/[id] —— 确认/编辑草稿/skipped/打卡（done|partial + actual） */
export const PATCH = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.updatePlan(ctx.user.id, String(id), body));
});
