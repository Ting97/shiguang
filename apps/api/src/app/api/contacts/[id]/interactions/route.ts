import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { createInteraction, listInteractions } from "@/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/interactions —— 手动补一笔往来 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await createInteraction(user.id, id, await req.json().catch(() => ({}))));
});

/** GET /api/contacts/:id/interactions —— 该联系人的往来列表（时间倒序，QA 验收补齐） */
export const GET = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await listInteractions(user.id, id));
});
