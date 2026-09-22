import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { reflectionService } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spaces/:id/reflections/:rid —— 全文（编辑/展开时拉取） */
export const GET = withAuthParams(async (_req, { user, params }) => {
  const { rid } = await params;
  return NextResponse.json(await reflectionService.get(user.id, rid));
});

/** PATCH /api/spaces/:id/reflections/:rid —— 编辑 { content }；updated_at=now()（列表据此刻画"已编辑"） */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { rid } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  return NextResponse.json(await reflectionService.update(user.id, rid, body));
});

/** DELETE /api/spaces/:id/reflections/:rid —— 硬删 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { rid } = await params;
  return NextResponse.json(await reflectionService.remove(user.id, rid));
});
