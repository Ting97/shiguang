import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/parse —— 粘贴课表文本 → AI 结构化草稿（不入库，返回给前端预览） */
export const POST = withAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  return NextResponse.json(await fitnessService.parsePlanDraft(user.id, String(body.text ?? "")));
});
