import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const PATCH = withModuleParams("fitness", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.updateGoal(ctx.user.id, String(id), body));
});
