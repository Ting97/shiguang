import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { reflectionService } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spaces/:id/reflections?limit=20&offset=0 —— 感悟列表（倒序；预览 300 字 + 字数） */
export const GET = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const url = new URL(req.url);
  // 非数字（如 ?limit=abc）回退默认值，避免 NaN 进 SQL 500；
  // isFinite 后仍可能带小数（?limit=1.5 → PG "LIMIT must be bigint" 500），trunc 取整
  const limitRaw = Number(url.searchParams.get("limit") ?? 20);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20, 1), 50);
  // offset 同理取整，并加 ≤10000 上限防深翻页
  const offset = Math.min(Math.max(Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0, 0), 10000);
  return NextResponse.json(await reflectionService.list(user.id, id, limit, offset));
});

/** POST /api/spaces/:id/reflections —— 新建感悟 { content } */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  return NextResponse.json(await reflectionService.create(user.id, id, body), { status: 201 });
});
