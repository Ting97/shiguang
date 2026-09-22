import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { spaceService, type SpaceCreateInput } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spaces —— 空间列表（active 在前）+ 聚合统计 */
export const GET = withAuth(async (_req, { user }) =>
  NextResponse.json(await spaceService.list(user.id)),
);

/** POST /api/spaces —— 创建空间；active 超过 20 个时 400 */
export const POST = withAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as SpaceCreateInput;
  return NextResponse.json(await spaceService.create(user.id, body));
});
