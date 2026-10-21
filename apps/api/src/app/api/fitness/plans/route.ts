import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/plans?from=&to= —— 区间日计划（北京日期 YYYY-MM-DD） */
export const GET = withModule("fitness", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listPlans(user.id, from, to));
});

/** POST /api/fitness/plans —— 新增草稿（联动今日行动）；readJsonCapped 替代裸 req.json() */
export const POST = withModule("fitness", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.savePlanDraft(user.id, body));
});
