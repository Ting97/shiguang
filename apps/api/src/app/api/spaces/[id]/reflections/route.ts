import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { reflectionService } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spaces/:id/reflections?limit=20&offset=0 —— 感悟列表（倒序；预览 300 字 + 字数） */
export const GET = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  return NextResponse.json(await reflectionService.list(user.id, id, limit, offset));
});

/** POST /api/spaces/:id/reflections —— 新建感悟 { content } */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  return NextResponse.json(await reflectionService.create(user.id, id, body), { status: 201 });
});
