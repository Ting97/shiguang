import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isUuid } from "@/server/platform/http/validate";
import { buildDigest, generateTradingReview, getTradingReviewCache } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/trading/review?accountId —— 只读缓存（不调 LLM 不耗配额） */
export const GET = withModule("trading", async (req, { user }) => {
  const accountId = new URL(req.url).searchParams.get("accountId") ?? "";
  // accountId 缺省/非法 uuid 落 assertAccountOwned 的 where id = $1 会 22P02 → 500
  if (!isUuid(accountId)) throw ApiError.badRequest("accountId 参数不合法");
  return NextResponse.json(await getTradingReviewCache(user.id, accountId));
});

/** POST /api/trading/review {accountId, refresh?} —— AI 复盘生成（FR-1.7）；
 * 失败/额度不足回落规则版 {fallback:true, digest}（零 token 兜底）。 */
export const POST = withModule("trading", async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { accountId?: string; refresh?: boolean };
  const accountId = body.accountId ?? "";
  if (!accountId) throw new ApiError(400, "invalid_input", "accountId 必填");
  if (!isUuid(accountId)) throw new ApiError(400, "invalid_input", "accountId 参数不合法");
  try {
    const r = await generateTradingReview(user.id, accountId, user.role, body.refresh === true);
    const { digest, ...rest } = r;
    return NextResponse.json({ ...rest, digest });
  } catch (e) {
    const fallbackReason = e instanceof ApiError ? e.message : "AI 解读失败";
    const retriable = e instanceof ApiError && [402, 429, 502, 503].includes(e.status);
    if (!retriable) throw e;
    const digest = await buildDigest(user.id, accountId).catch(() => null);
    return NextResponse.json({ fallback: true, fallbackReason, digest });
  }
});
