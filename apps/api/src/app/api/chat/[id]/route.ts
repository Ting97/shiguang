import { NextResponse } from "next/server";
import { z } from "zod";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { chatService } from "@/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const renameSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(30, "标题最长 30 字"),
});

/** PATCH /api/chat/[id] —— 会话改名 */
export const PATCH = withModuleParams("ai", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const parsed = renameSchema.safeParse(await readJsonCapped(req) as any);
  if (!parsed.success) throw ApiError.badRequest("标题长度须为 1~30 字");
  await chatService.renameConversation(user.id, id, parsed.data.title);
  return NextResponse.json({ ok: true });
});

/** DELETE /api/chat/[id] —— 会话软删（列表隐藏，消息保留审计追溯） */
export const DELETE = withModuleParams("ai", async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  await chatService.deleteConversation(user.id, id);
  return NextResponse.json({ ok: true });
});
