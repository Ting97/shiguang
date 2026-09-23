import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { dismissScheduleConflict } from "@/server/timeline";

export const runtime = "nodejs";

/** POST /api/feed/:id/dismiss-conflict —— 关闭日程冲突警示条（服务端标记 reasonDismissed，多端持久） */
export const POST = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await dismissScheduleConflict(user.id, id));
});
