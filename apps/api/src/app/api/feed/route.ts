import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthQuery } from "@/server/platform/http/route";
import { listFeed } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(10),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().default(""),
  spaceId: z.string().default("all"),
  // 历史回看锚点（ISO 时刻）：只取早于该时刻的动态，首条=锚点日的最后一条
  before: z.string().datetime().optional(),
});

/** GET /api/feed —— 动态流（聚合识别产物/关键字检索/空间过滤） */
export const GET = withAuthQuery(schema, async (_req, { user, valid }) => {
  const q = valid.q.trim();
  return NextResponse.json(await listFeed(user.id, { ...valid, q }));
});
