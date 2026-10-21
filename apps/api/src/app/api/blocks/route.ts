import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { createBlock, overlapPayload } from "@/server/time";

export const runtime = "nodejs";

/** POST /api/blocks —— 手动创建时间块（日视图缺口补录）；不允许与已有日程重叠（409 带 conflict） */
export const POST = withModule("time", async (req, { user }) => {
  const r = await createBlock(user.id, await readJsonCapped(req) as any);
  if ("conflict" in r) return NextResponse.json(overlapPayload(r.conflict), { status: 409 });
  return NextResponse.json({ block: r.block });
});
