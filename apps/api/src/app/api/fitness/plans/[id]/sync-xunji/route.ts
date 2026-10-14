import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/sync-xunji —— 计划双写训记 App（用户点按钮即确认；二次同步走更新防重复） */
export const POST = withAuthParams(async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await fitnessService.syncPlanToXunji(ctx.user.id, String(id)));
});
