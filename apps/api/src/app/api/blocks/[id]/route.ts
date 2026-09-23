import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { deleteBlock, overlapPayload, updateBlock } from "@/server/time";

export const runtime = "nodejs";

/** PATCH /api/blocks/:id —— 修改时间块（标题/起止时间/类别）；新时间段不得与其他块重叠（409 带 conflict） */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const r = await updateBlock(user.id, id, await req.json().catch(() => ({})));
  if ("conflict" in r) return NextResponse.json(overlapPayload(r.conflict), { status: 409 });
  return NextResponse.json({ block: r.block });
});

/** DELETE /api/blocks/:id —— 删除时间块 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await deleteBlock(user.id, id));
});
