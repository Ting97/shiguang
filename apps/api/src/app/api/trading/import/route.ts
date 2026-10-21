import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { importTrades } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/import —— R1 报表导入（FR-1.1/1.2）：body {dryRun, login, nickname?, fileName, source, rows[]}。
 * readJsonCapped 1MB 上限：替代裸 req.json()，超大 body 流式计数拒绝（rows 上限 5 万行的深度防御） */
export const POST = withModule("trading", async (req, { user }) => {
  const body = (await readJsonCapped(req)) as Parameters<typeof importTrades>[1];
  return NextResponse.json(await importTrades(user.id, body));
});
