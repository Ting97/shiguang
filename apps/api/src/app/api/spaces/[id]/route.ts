import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { spaceService, type SpacePatchInput } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/spaces/:id —— 字段修改 + {status:'archived'|'active'} 归档/恢复 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as SpacePatchInput;
  return NextResponse.json(await spaceService.update(user.id, id, body));
});

/** DELETE /api/spaces/:id —— 硬删空间；entries/todos.space_id 由外键 on delete set null 兜底，业务数据完好 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await spaceService.remove(user.id, id));
});
