import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/pull-xunji —— 从训记回读完成数据自动打卡（复用 016 状态机：落日志+行动完成）。
 * body { preview?: boolean }：true 只读训记组装 actual 不打卡（前端预览弹窗） */
export const POST = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const preview = Boolean((body as { preview?: boolean })?.preview);
  return NextResponse.json(await fitnessService.pullXunjiCompletion(ctx.user.id, String(id), { preview }));
});
