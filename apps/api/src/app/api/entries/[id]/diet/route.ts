import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { deleteEntryDiet } from "@/server/timeline";

export const runtime = "nodejs";

/** DELETE /api/entries/:id/diet —— 删除该动态的饮食记录（识别产物可单独删除） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await deleteEntryDiet(user.id, id));
});
