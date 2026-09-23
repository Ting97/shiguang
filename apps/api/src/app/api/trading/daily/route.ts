import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isUuid } from "@/server/platform/http/validate";
import { dailyPnl } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/daily?accountId&from&to —— 按日聚合（FR-1.4） */
export const GET = withModule("trading", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const accountId = sp.get("accountId") ?? "";
  // accountId 缺省/非法 uuid 落 assertAccountOwned 的 where id = $1 会 22P02 → 500
  if (!isUuid(accountId)) throw ApiError.badRequest("accountId 参数不合法");
  return NextResponse.json(
    await dailyPnl(user.id, accountId, sp.get("from") ?? "", sp.get("to") ?? ""),
  );
});
