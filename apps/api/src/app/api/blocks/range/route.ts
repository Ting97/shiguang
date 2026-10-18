import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { listBlocksInRange } from "@/server/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blocks/range?from=YYYY-MM-DD&to=YYYY-MM-DD —— 区间内原始时间块 */
export const GET = withModule("time", async (req, { user }) => {
  const url = new URL(req.url);
  return NextResponse.json(
    await listBlocksInRange(user.id, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""),
  );
});
