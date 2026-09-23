import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { buildDigest } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/digest?accountId —— 规则统计素材（FR-1.7，纯计算零 LLM，页面常显） */
export const GET = withModule("trading", async (req, { user }) => {
  const accountId = new URL(req.url).searchParams.get("accountId") ?? "";
  return NextResponse.json(await buildDigest(user.id, accountId));
});
