import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { confirmPending } from "@/server/timeline";

export const runtime = "nodejs";

/** POST /api/entries/:id/confirm —— 确认 pending 识别落库；ignore=true 丢弃 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await confirmPending(user.id, id, body?.domain, body?.ignore === true));
});
