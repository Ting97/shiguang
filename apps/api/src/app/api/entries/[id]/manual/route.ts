import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { appendManual } from "@/server/timeline";

export const runtime = "nodejs";

/**
 * POST /api/entries/:id/manual { domain, payload } —— 手动补充识别产物（不经 AI）
 * 六域各自落库并写登记簿（engine='manual'），来源动态在动态流中完整呈现。
 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as {
    domain?: string;
    payload?: Record<string, unknown>;
  };
  return NextResponse.json(await appendManual(user.id, id, body));
});
