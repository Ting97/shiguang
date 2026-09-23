import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { equityCurve } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/equity?accountId —— 累计净盈亏曲线 + 峰值/回撤段/两阶段（FR-1.5，服务端算好） */
export const GET = withModule("trading", async (req, { user }) => {
  const accountId = new URL(req.url).searchParams.get("accountId") ?? "";
  return NextResponse.json(await equityCurve(user.id, accountId));
});
