import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/pull-xunji —— 从训记回读完成数据自动打卡（复用 016 状态机：落日志+行动完成）。
 * body { preview?: boolean }：true 只读训记组装 actual 不打卡（前端预览弹窗） */
export const POST = withModuleParams("fitness", async (req, ctx) => {
  // 训记凭据是部署级唯一 XUNJI_API_KEY（运营者账号）：回读到的是运营者当日实练——
  // 普通注册用户不得读取他人训练数据（与 chat/tools 的 queryXunjiTrains 同口径 admin 收口）
  if (ctx.user.role !== "admin") throw ApiError.forbidden("训记回读使用部署级账号，仅管理员可用");
  const { id } = await ctx.params;
  assertUuidParam(id, "id"); // 畸形 id 直落 PG 22P02 → 500（十四轮补齐）
  const body = await readJsonCapped(req) as any;
  const preview = Boolean((body as { preview?: boolean })?.preview);
  return NextResponse.json(await fitnessService.pullXunjiCompletion(ctx.user.id, String(id), { preview }));
});
