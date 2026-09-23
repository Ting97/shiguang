import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { patchFeed, deleteFeed } from "@/server/timeline";

export const runtime = "nodejs";

const patchSchema = z.object({
  mood: z.string().nullish(),
  raw_text: z.string().optional(),
  spaceId: z.string().nullish(),
});

/** PATCH /api/feed/:id —— 手动归属空间 / 编辑原文重识别 / 修正心情 */
export const PATCH = withAuthParams(async (req: NextRequest, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await patchFeed(user.id, id, patchSchema.parse(body ?? {})));
});

/** DELETE /api/feed/[id] —— 删除动态及其全部识别产物 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await deleteFeed(user.id, id));
});
