import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const PATCH = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.updateGoal(ctx.user.id, String(id), body));
});
