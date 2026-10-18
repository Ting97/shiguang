import { NextResponse } from "next/server";
import { withModuleParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const PATCH = withModuleParams("fitness", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.updateGoal(ctx.user.id, String(id), body));
});
