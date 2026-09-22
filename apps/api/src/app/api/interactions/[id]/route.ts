import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { deleteInteraction, updateInteraction } from "@/server/people";

export const runtime = "nodejs";

/** PATCH /api/interactions/:id —— 修正往来记录（type/summary/occurredAt；QA 验收补齐） */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await updateInteraction(user.id, id, await req.json().catch(() => ({}))));
});

/** DELETE /api/interactions/:id —— 删除识别错的人际往来关联（不动联系人档案本身） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await deleteInteraction(user.id, id));
});
