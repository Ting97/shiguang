import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { cachedAiProfile, generateAiProfile } from "@/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts/:id/ai-profile —— 只读已缓存的画像（不触发 AI；QA 验收补齐） */
export const GET = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await cachedAiProfile(user.id, id));
});

/** POST /api/contacts/:id/ai-profile —— 基于往来记录提炼「AI 交往画像」（W10 遗留） */
export const POST = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  return NextResponse.json(await generateAiProfile(user.id, id));
});
