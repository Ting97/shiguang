import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { contactDetail, deleteContact, updateContact } from "@/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts/:id —— TA 的档案：基本信息 + 往来时间线 + 关联人情账 */
export const GET = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await contactDetail(user.id, id));
});

/** PATCH /api/contacts/:id —— 编辑档案 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await updateContact(user.id, id, await req.json().catch(() => ({}))));
});

/** DELETE /api/contacts/:id —— 删除联系人（往来事件级联删除，动态本体与流水不受影响） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await deleteContact(user.id, id));
});
