import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { createInteraction, listInteractions } from "@/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/interactions —— 手动补一笔往来 */
export const POST = withModuleParams("people", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await createInteraction(user.id, id, await readJsonCapped(req) as any));
});

/** GET /api/contacts/:id/interactions —— 该联系人的往来列表（时间倒序，QA 验收补齐） */
export const GET = withModuleParams("people", async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await listInteractions(user.id, id));
});
