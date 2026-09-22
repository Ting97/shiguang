import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { confirmPending } from "@/server/timeline";

export const runtime = "nodejs";

/** POST /api/entries/:id/confirm —— 确认 pending 识别落库；ignore=true 丢弃 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await confirmPending(user.id, id, body?.domain, body?.ignore === true));
});
