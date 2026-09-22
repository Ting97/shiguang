import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { activityStatsInRange } from "@/server/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stats/range?from=&to= —— 按日按类别的时长聚合（月视图/年热力图/趋势用） */
export const GET = withAuth(async (req, { user }) => {
  const url = new URL(req.url);
  return NextResponse.json(
    await activityStatsInRange(user.id, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""),
  );
});
