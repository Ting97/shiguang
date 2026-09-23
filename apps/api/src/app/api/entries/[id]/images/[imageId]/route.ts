import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { deleteEntryImage } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/entries/:id/images/:imageId —— 删除单张图片（删行 + 异步删盘上文件） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id, imageId } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  assertUuidParam(imageId, "imageId"); // 同上：imageId 非法 uuid 先拦成 400
  return NextResponse.json(await deleteEntryImage(user.id, id, imageId));
});
