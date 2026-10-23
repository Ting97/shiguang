import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/pull-xunji —— 从训记回读完成数据自动打卡（复用 016 状态机：落日志+行动完成）。
 * body { preview?: boolean }：true 只读训记组装 actual 不打卡（前端预览弹窗） */
export const POST = withModuleParams("fitness", async (req, ctx) => {
  // REQ-042：回读用户自己绑定的训记账号的实练（service 层校验绑定）——不再部署级运营者账号，无需 admin 收口
  const { id } = await ctx.params;
  assertUuidParam(id, "id"); // 畸形 id 直落 PG 22P02 → 500（十四轮补齐）
  const body = await readJsonCapped(req) as any;
  const preview = Boolean((body as { preview?: boolean })?.preview);
  return NextResponse.json(await fitnessService.pullXunjiCompletion(ctx.user.id, String(id), { preview }));
});
