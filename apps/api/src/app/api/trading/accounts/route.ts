import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { listAccounts } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/accounts —— 账号列表 + 汇总（FR-1.3） */
export const GET = withModule("trading", async (_req, { user }) => {
  return NextResponse.json(await listAccounts(user.id));
});
