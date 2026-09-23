import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { dailyPnl } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/daily?accountId&from&to —— 按日聚合（FR-1.4） */
export const GET = withModule("trading", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const accountId = sp.get("accountId") ?? "";
  return NextResponse.json(
    await dailyPnl(user.id, accountId, sp.get("from") ?? "", sp.get("to") ?? ""),
  );
});
