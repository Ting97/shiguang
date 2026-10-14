import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/plans?from=&to= —— 区间日计划（北京日期 YYYY-MM-DD） */
export const GET = withAuth(async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listPlans(user.id, from, to));
});

/** POST /api/fitness/plans —— create-or-replace 草稿（联动今日行动） */
export const POST = withAuth(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.savePlanDraft(user.id, body));
});
