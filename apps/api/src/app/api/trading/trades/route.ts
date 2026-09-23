import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { listTrades } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/trades?accountId&from&to&dir&period&durBand&pnlBand&page —— 逐笔明细（FR-1.6） */
export const GET = withModule("trading", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  return NextResponse.json(
    await listTrades(user.id, {
      accountId: sp.get("accountId") ?? "",
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      dir: sp.get("dir") ?? undefined,
      period: sp.get("period") ?? undefined,
      durBand: sp.get("durBand") ?? undefined,
      pnlBand: sp.get("pnlBand") ?? undefined,
      page: Number(sp.get("page") ?? 1),
    }),
  );
});
