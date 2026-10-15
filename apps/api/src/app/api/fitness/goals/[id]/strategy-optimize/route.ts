import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/goals/[id]/strategy-optimize —— AI 一键优化策略档案（只建议不落库，REQ-019 FR-A4） */
export const POST = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.optimizeStrategy(ctx.user.id, String(id), body));
});
