import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isUuid } from "@/server/platform/http/validate";
import { buildDigest } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/digest?accountId —— 规则统计素材（FR-1.7，纯计算零 LLM，页面常显） */
export const GET = withModule("trading", async (req, { user }) => {
  const accountId = new URL(req.url).searchParams.get("accountId") ?? "";
  // accountId 缺省/非法 uuid 落 assertAccountOwned 的 where id = $1 会 22P02 → 500
  if (!isUuid(accountId)) throw ApiError.badRequest("accountId 参数不合法");
  return NextResponse.json(await buildDigest(user.id, accountId));
});
