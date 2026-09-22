import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { deleteEntryImage } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/entries/:id/images/:imageId —— 删除单张图片（删行 + 异步删盘上文件） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id, imageId } = await params;
  return NextResponse.json(await deleteEntryImage(user.id, id, imageId));
});
