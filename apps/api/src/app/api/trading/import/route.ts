import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { importTrades } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/import —— R1 报表导入（FR-1.1/1.2）：body {dryRun, login, nickname?, fileName, source, rows[]} */
export const POST = withModule("trading", async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof importTrades>[1];
  return NextResponse.json(await importTrades(user.id, body));
});
