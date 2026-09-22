import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { reRecognize } from "@/server/timeline";

export const runtime = "nodejs";

/**
 * POST /api/entries/:id/recognize { domain } —— 单域重新识别（替换式）
 * mood: 覆写/清空 | schedule: 冲突检测通过才换块 | todo/finance: 删旧落新 | diet: upsert
 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const { domain } = (await req.json().catch(() => ({}))) as { domain?: string };
  return NextResponse.json(await reRecognize(user.id, id, domain));
});
