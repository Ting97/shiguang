import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/plans?from=&to= —— 区间日计划（北京日期 YYYY-MM-DD） */
export const GET = withModule("fitness", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listPlans(user.id, from, to));
});

/** POST /api/fitness/plans —— 新增草稿（联动今日行动）；readJsonCapped 替代裸 req.json()。
 * body.syncXunji 为真时与 /sync-xunji 路由同口径 admin 收口：训记凭据是部署级唯一运营者账号，
 * 外部 API 无删除接口——不能让普通用户绕过 sync-xunji 路由经保存入参直写训记 */
export const POST = withModule("fitness", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  if (body?.syncXunji === true && user.role !== "admin") {
    throw ApiError.forbidden("训记同步使用部署级账号，仅管理员可用");
  }
  return NextResponse.json(await fitnessService.savePlanDraft(user.id, body));
});
